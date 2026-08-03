# GrapeScrape production brand assets

The production frontend and Cognito managed login use:

- `src/ui/public/grapescrape-mark.svg` for the browser favicon and compact mark;
- `src/ui/public/grapescrape-logo.svg` for the managed-login form logo.

Both SVGs were drawn for GrapeScrape in CM-48. They adapt the circular glyph
already present in the merged production `Brand.tsx` component and the warm
neutral, charcoal, restrained-green and italic wordmark direction in the
approved `src/ui/grapescrape_prototype.zip`. No image, HTML, JavaScript or
simulator fixture was copied out of the prototype archive.

The assets are original project work and follow this private repository's
`UNLICENSED` status. They do not contain third-party artwork or proprietary
font binaries. The wordmark specifies Georgia with a generic serif fallback;
rendering uses fonts already available to the browser or Cognito service.

The application itself continues to load Instrument Serif, Hanken Grotesk and
IBM Plex Mono from Google Fonts. Google Fonts supplies these open-source font
families under their respective licences; no font files are committed here.
The CloudFront content-security policy permits only the required Google Fonts
stylesheet and font origins.

The archive remains design reference material and is deliberately outside
Vite's `public` directory. Deployment safety checks reject the archive,
generated `.dc.html`, `support.js`, screenshots and simulator artifacts if
they ever appear in a production build.
