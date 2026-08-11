import type { MetadataRoute } from 'next';

/**
 * What a browser reads when someone keeps this app rather than visits it.
 *
 * It exists for the icon, but the icon is not the only thing that was wrong when there was no
 * manifest. Added to a Home Screen the app was a grey square with a `T` in it, labelled with
 * the whole strapline — "TRO — Trade · Risk · Outcome" — which iOS then truncates to about
 * nine characters of it. `short_name` is what sits under the icon; `name` is what the install
 * sheet shows.
 *
 * `start_url` is the front door and not whichever page the person happened to be on when they
 * added it. `/` redirects to the dashboard when there is a session and to the login screen
 * when there is not, which is exactly what an installed app should decide on launch.
 *
 * The two PNGs come from `scripts/render-icons.mjs`, which draws them from `icon.svg` — see
 * the note there about why a rasteriser and not three hand-made files.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TRO — Trade · Risk · Outcome',
    short_name: 'TRO',
    description: 'Trading journal and personal finance dashboard.',
    start_url: '/',
    display: 'standalone',
    /*
     * The mark's own ground, not the page's.
     *
     * `background_color` paints the splash screen while the app boots, and it is the one
     * colour that has to agree with the icon rather than with the interface: for the second
     * it is on screen the icon sits in the middle of it, and a page-coloured splash puts a
     * near-black tile on a slightly different near-black.
     */
    background_color: '#0b0f14',
    // …whereas this one is the page, because it tints the chrome *around* the running app.
    theme_color: '#0b1017',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
