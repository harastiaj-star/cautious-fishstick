# Trailhead

Tools for making things by hand. Trailhead is a set of small design tools and photo experiments for posters, zines, patches, trail maps and other work that should look printed. It comes with a Photoshop plugin that opens your files with the layers intact.

Everything runs in the browser. Photos people open stay on their device. There's no server, no build step and no sign-up.

## What's in this repo

```
index.html              The whole site: markup, styles and scripts in one file
fonts/                  TAY Dumpling and TAY Sundae (see "Before you make this public")
photos/                 The four example photos used across the tools
icons/                  App icons, tab icons and the social preview card (social-card.jpg)
thumbs/                 Small before/after pictures shown on tool pages and in search
videos/                 The example clip for the Video tools, as MP4 and WebM
manifest.webmanifest    Lets phones and computers install Trailhead as an app
sw.js                   Service worker: keeps a copy of the site so it works offline
404.html                The "off the trail" page GitHub shows for broken links
downloads/              trailhead-for-photoshop.zip, served by the home page's download button
photoshop-plugin/       Source for the Photoshop panel (UXP, manifest v5)
scripts/build-plugin.sh Rebuilds the plugin zip after you change the plugin
```

The site loads two libraries from jsDelivr: [ag-psd](https://github.com/Agamnentzar/ag-psd) 31.0.2 writes the layered .psd files and [opentype.js](https://github.com/opentypejs/opentype.js) 1.3.4 builds the fonts in Letter maker. Both are MIT licensed. Some tools load more when you open them: [MindAR](https://github.com/hiukim/mind-ar-js) 1.2.5 for Living prints, [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 for QR codes and [aes-js](https://github.com/ricmoo/aes-js) 3.1.2 for the Pocket scanner, all MIT licensed. Lake color year reads NASA GIBS satellite images and the Pocket scanner passes encrypted photos through [ntfy.sh](https://ntfy.sh). Everything else is plain JavaScript in `index.html`.

The site follows the visitor's light or dark setting, and the round button in the bottom-left corner switches between them.

## Run it on your computer

Opening `index.html` by double-clicking mostly works. The example photos and the plugin download won't load from a `file://` address, though, so use a small local server:

```
cd trailhead
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Put it online with GitHub Pages

1. Create a new repository on GitHub and upload everything in this folder, keeping the folders as they are. You can drag the files onto the repository page or use `git push`.
2. In the repository, open **Settings › Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, and save.
4. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

The `.nojekyll` file tells GitHub Pages to serve the files as they are.

## Offline and install

After someone visits once, `sw.js` keeps a copy of the page, fonts, photos and libraries, so the site opens with no connection. The page itself is always fetched fresh when online, so updates show up right away. If you add new files the site needs offline, list them in `CORE` in `sw.js` and bump `VERSION`.

## Share previews

The preview image for links shared on social media and in texts is set in the `<head>` of `index.html` (`og:image`). It points at `https://harastiaj-star.github.io/trailheadtools/icons/social-card.jpg`. If you rename the repository or add a custom domain, update that address.

## Updating the plugin

See [photoshop-plugin/README.md](photoshop-plugin/README.md). In short: edit the plugin, bump the version in `manifest.json`, run `bash scripts/build-plugin.sh`, and commit the new zip.

## Before you make this public

- **Fonts.** TAY Dumpling and TAY Sundae are commercial fonts. Check that your license covers web embedding and hosting the .woff files in a public repository. If it doesn't, make the repository private (GitHub Pages on a private repository needs a paid plan) or replace the fonts.
- **Photos.** Make sure you have the rights to every photo in `photos/`. Swap any you didn't take yourself for your own or for properly licensed ones.
- **License.** There's no license file yet, which means nobody else may reuse the code. If you want people to be able to, add one. GitHub offers a picker when you create a file called `LICENSE`.
