# Trailhead for Photoshop

A Photoshop panel that opens what you make on the Trailhead site.

- **Open a Trailhead file**: pick a zip you saved from the site. The layered .psd opens and any swatches go into your Swatches panel. You don't need to unzip anything. Plain .psd, .png and .ase files work too.
- **Trailhead filters**: runs Linocut, Photo to topo, Line art, Cyanotype print or Cyanotype negative on everything visible in your document. The result lands on a new layer, with an optional paper layer underneath, so your original stays untouched.
- **Palettes**: all ten Trailhead palettes. Tap a color to make it your foreground color, or add a whole palette to Swatches.
- **Colors from this document**: finds the main colors in whatever you have open (3 to 8 of them) and adds them to Swatches.
- **Pocket scanner**: press Pair a phone and scan the code. Photos taken on the site's Pocket scanner page land in your open document as a placed layer, or open as a new document. Photos are encrypted on the phone with a key only this panel has, then passed through [ntfy.sh](https://ntfy.sh), which deletes them within three hours. Keep the panel open while you scan.
- **Textures**: paper grain, speckle, halftone, stamp wear and topo lines, painted in your chosen ink on a new layer the size of your document.

Works with Photoshop 2023 (version 24.2) or newer. Filters, textures and pulling colors need Photoshop 2024 or newer.

## Install

The easy way is the download button on the site's home page. It gives you `Trailhead.ccx`. Quit Photoshop, double-click the file, and choose **Install locally** when Creative Cloud warns you that the plugin isn't verified by Adobe. Then open **Plugins › Trailhead** in Photoshop.

If Creative Cloud refuses, or you're working on the plugin itself, load it from this folder instead:

1. In the **Creative Cloud** app, install **UXP Developer Tool** (free, under Apps).
2. Open Photoshop, then open UXP Developer Tool.
3. Click **Add Plugin** and choose `manifest.json` in this folder.
4. Click **•••** next to Trailhead and choose **Load**.
5. In Photoshop, open **Plugins › Trailhead**.

A plugin loaded this way has to be loaded again after Photoshop restarts.

## Making changes

Edit `index.html` (layout and styles) or `main.js` (everything it does), then press **Reload** in UXP Developer Tool to see the change. When you're happy with it, bump `version` in `manifest.json` and run this from the repo root:

```
bash scripts/build-plugin.sh
```

That rebuilds `downloads/trailhead-for-photoshop.zip`, which is the file the site hands out.

## Good to know

- `aes.js` is [aes-js](https://github.com/ricmoo/aes-js) by Richard Moore and `qrcode.js` is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase, both MIT License, bundled unchanged.
- The pocket scanner needs the network permission for `https://ntfy.sh` in `manifest.json`. Photoshop asks nothing extra for it.

- Textures need an RGB document (Image › Mode › RGB Color).
- Fonts from the Letter maker install outside Photoshop. Double-click the .otf, then restart Photoshop.
- If another app repacks a Trailhead zip, unzip it and open the file inside instead.
- The plugin id is `com.trailhead.photoshop`. Keep it the same across versions so updates replace the old install instead of sitting next to it.
