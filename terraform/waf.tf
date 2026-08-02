# TRi Web Application Firewall (WAF) Infrastructure as Code
#
# This Terraform configuration manages WAF resources for TRi.
# Supports both AWS WAF and CloudFlare (via Terraform provider).
#
# Usage:
#   terraform plan -var-file="environments/production.tfvars"
#   terraform apply -var-file="environments/production.tfvars"

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # Store state in S3 with encryption
  backend "s3" {
    bucket         = "tri-terraform-state"
    key            = "waf.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}

# Variables
variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
  default     = "production"
}

variable "waf_mode" {
  description = "WAF mode: log-only, challenge, or block"
  type        = string
  default     = "log-only"
  validation {
    condition     = contains(["log-only", "challenge", "block"], var.waf_mode)
    error_message = "WAF mode must be log-only, challenge, or block."
  }
}

variable "app_name" {
  description = "Application name"
  type        = string
  default     = "tri"
}

variable "waf_provider" {
  description = "WAF provider: aws or cloudflare"
  type        = string
  default     = "aws"
  validation {
    condition     = contains(["aws", "cloudflare"], var.waf_provider)
    error_message = "WAF provider must be aws or cloudflare."
  }
}

variable "alb_arn" {
  description = "ARN of the Application Load Balancer"
  type        = string
  default     = ""
}

variable "cloudfront_id" {
  description = "CloudFront distribution ID"
  type        = string
  default     = ""
}

variable "cloudflare_zone_id" {
  description = "CloudFlare zone ID"
  type        = string
  sensitive   = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "global_rate_limit_requests" {
  description = "Global rate limit requests per minute"
  type        = number
  default     = 100
}

# AWS WAF Configuration
resource "aws_wafv2_web_acl" "tri_waf" {
  count = var.waf_provider == "aws" ? 1 : 0

  name  = "${var.app_name}-waf-${var.environment}"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # SQL Injection Protection
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "SQLiProtectionMetrics"
      sampled_requests_enabled   = true
    }
  }

  # XSS Protection
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        # Exclude rules that may cause false positives
        excluded_rule {
          name = "SizeRestrictions_BODY"
        }

        excluded_rule {
          name = "GenericRFI_BODY"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRuleSetMetrics"
      sampled_requests_enabled   = true
    }
  }

  # Known Bad Inputs
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "KnownBadInputsMetrics"
      sampled_requests_enabled   = true
    }
  }

  # Linux Rule Set
  rule {
    name     = "AWSManagedRulesLinuxRuleSet"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesLinuxRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "LinuxRuleSetMetrics"
      sampled_requests_enabled   = true
    }
  }

  # Global Rate Limiting
  rule {
    name     = "GlobalRateLimit"
    priority = 10

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.global_rate_limit_requests * 60  # Convert per-minute to per-300s
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "GlobalRateLimitMetrics"
      sampled_requests_enabled   = true
    }
  }

  # Authentication Endpoint Rate Limiting (stricter)
  rule {
    name     = "AuthEndpointRateLimit"
    priority = 11

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 5 * 60  # 5 requests per 15 minutes (per 900s)
        aggregate_key_type = "IP"
      }

      # Only match auth endpoints
      # TODO: Add scope-down statement for /auth/* paths
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AuthRateLimitMetrics"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.app_name}-waf-metrics"
    sampled_requests_enabled   = true
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# Associate WAF with ALB
resource "aws_wafv2_web_acl_association" "alb" {
  count = var.waf_provider == "aws" && var.alb_arn != "" ? 1 : 0

  resource_arn = var.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.tri_waf[0].arn
}

# Associate WAF with CloudFront
resource "aws_wafv2_web_acl_association" "cloudfront" {
  count = var.waf_provider == "aws" && var.cloudfront_id != "" ? 1 : 0

  resource_arn = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${var.cloudfront_id}"
  web_acl_arn  = aws_wafv2_web_acl.tri_waf[0].arn
}

# CloudWatch Log Group for WAF Logs
resource "aws_cloudwatch_log_group" "waf_logs" {
  count = var.waf_provider == "aws" ? 1 : 0

  name              = "/aws/wafv2/${var.app_name}-${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# CloudWatch Log Resource Policy for WAF
resource "aws_cloudwatch_log_resource_policy" "waf_logs" {
  count = var.waf_provider == "aws" ? 1 : 0

  policy_name = "${var.app_name}-waf-logs-policy"

  policy_text = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "wafv2.amazonaws.com"
        }
        Action   = "logs:PutLogEvents"
        Resource = "${aws_cloudwatch_log_group.waf_logs[0].arn}:*"
      }
    ]
  })
}

# Enable WAF Logging
resource "aws_wafv2_web_acl_logging_configuration" "waf_logs" {
  count = var.waf_provider == "aws" ? 1 : 0

  resource_arn            = aws_wafv2_web_acl.tri_waf[0].arn
  log_destination_configs = [aws_cloudwatch_log_group.waf_logs[0].arn]

  depends_on = [aws_cloudwatch_log_resource_policy.waf_logs]
}

# CloudFlare WAF Configuration (Alternative)
resource "cloudflare_firewall_rule" "sql_injection" {
  count = var.waf_provider == "cloudflare" ? 1 : 0

  zone_id     = var.cloudflare_zone_id
  description = "Block SQL Injection Attempts"
  filter_id   = cloudflare_firewall_filter.sql_injection[0].id
  action      = var.waf_mode == "log-only" ? "log" : var.waf_mode == "challenge" ? "challenge" : "block"

  depends_on = [cloudflare_firewall_filter.sql_injection]
}

resource "cloudflare_firewall_filter" "sql_injection" {
  count = var.waf_provider == "cloudflare" ? 1 : 0

  zone_id     = var.cloudflare_zone_id
  description = "SQL Injection Detection Filter"

  expression = "(cf.threat_score > 50) or (http.request.uri.query contains \"' UNION\") or (http.request.uri.query contains \"' OR \") or (http.request.body contains \"' UNION\") or (http.request.body contains \"' OR \")"
}

# CloudFlare Rate Limiting
resource "cloudflare_rate_limit" "global" {
  count = var.waf_provider == "cloudflare" ? 1 : 0

  zone_id     = var.cloudflare_zone_id
  disabled    = false
  description = "Global rate limit"

  threshold = var.global_rate_limit_requests
  period    = 60

  match {
    request {
      url {
        path_matches = "/*"
      }
    }
  }

  action {
    timeout = 86400
    response {
      code         = 429
      reason       = "Too Many Requests"
      content_type = "application/json"
      content      = "{\"error\": \"Rate limit exceeded\"}"
    }
  }
}

# CloudFlare Rate Limiting for Auth Endpoints
resource "cloudflare_rate_limit" "auth" {
  count = var.waf_provider == "cloudflare" ? 1 : 0

  zone_id     = var.cloudflare_zone_id
  disabled    = false
  description = "Auth endpoint rate limit"

  threshold = 5
  period    = 900

  match {
    request {
      url {
        path_matches = "/auth/login"
      }
    }
  }

  action {
    timeout = 86400
    response_code = 429
  }
}

# CloudFlare Origin Shield
resource "cloudflare_cache_settings" "origin_shield" {
  count = var.waf_provider == "cloudflare" ? 1 : 0

  zone_id              = var.cloudflare_zone_id
  caching_level        = "cache_everything"
  browser_cache_ttl    = 1800
  browser_check        = true
  cache_on_cookie      = "session_id"
  cache_ttl_by_status  = {}
  development_mode     = false
  email_obfuscation    = "on"
  hotlink_protection   = "off"
  ip_geolocation       = "on"
  mirage               = "off"
  origin_cache_control = true
  Polish               = "off"
  prefetch_preload     = true
  rocket_loader        = "off"
  security_header      = "off"
  server_side_exclude  = "on"
}

# Outputs
output "waf_arn" {
  description = "ARN of the created WAF"
  value       = var.waf_provider == "aws" ? aws_wafv2_web_acl.tri_waf[0].arn : "N/A (CloudFlare)"
}

output "waf_id" {
  description = "ID of the created WAF"
  value       = var.waf_provider == "aws" ? aws_wafv2_web_acl.tri_waf[0].id : "N/A (CloudFlare)"
}

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = var.waf_provider == "aws" ? aws_cloudwatch_log_group.waf_logs[0].name : "N/A (CloudFlare)"
}

output "deployment_command" {
  description = "Command to deploy WAF rules"
  value       = "npm run waf:deploy -- --environment ${var.waf_mode}"
}

# Data source for current AWS account
data "aws_caller_identity" "current" {}
