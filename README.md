# Matthias Markowski — Portfolio

A static portfolio focused on creative software development, real-time 3D, WebGL, VR, and interactive installations. The visual background combines Three.js, a GPU fluid simulation, and a licensed anglerfish model.

## Local development

```sh
npm install
npm run dev
```

The site is served at `http://localhost:8080`.

## Validation

```sh
npm run check
```

This checks JavaScript syntax, duplicate HTML IDs, local file references, JSON-LD, and essential accessibility/SEO hooks.

## Performance testing

Use `?tier=low`, `?tier=mid`, or `?tier=high` to pin a rendering tier. Add `?fps` to show the live FPS meter.

## Deployment

The repository is a static GitHub Pages site. Publish the repository root. `robots.txt` and `sitemap.xml` assume the production URL is `https://mshad.github.io/`.

## Asset credit

The anglerfish is based on [“Anglerfish” by Karstart](https://sketchfab.com/3d-models/anglerfish-0047a66766394a018fdab16279fee694), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See `anglerfish/license.txt` for details.
