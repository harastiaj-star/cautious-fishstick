# Trailhead

Tools for making things by hand. Trailhead is a set of small design tools and photo experiments for posters, zines, patches, trail maps and other work that should look printed. It comes with a Photoshop plugin that opens your files with the layers intact.

Everything runs in the browser. Photos people open stay on their device. There's no server, no build step and no sign-up.

## What's in this repo

```
index.html              The whole site: markup, styles and scripts in one file
fonts/                  TAY Dumpling and TAY Sundae (see "Before you make this public")
photos/                 The four example photos used across the tools
downloads/              trailhead-for-photoshop.zip, served by the home page's download button
photoshop-plugin/       Source for the Photoshop panel (UXP, manifest v5)
scripts/build-plugin.sh Rebuilds the plugin zip after you change the plugin
```

The site loads two libraries from jsDelivr: [ag-psd](https://github.com/Agamnentzar/ag-psd) 31.0.2 writes the layered .psd files and [opentype.js](https://github.com/opentypejs/opentype.js) 1.3.4 builds the fonts in Letter maker. Both are MIT licensed. Everything else is plain JavaScript in `index.html`.

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

## Updating the plugin

See [photoshop-plugin/README.md](photoshop-plugin/README.md). In short: edit the plugin, bump the version in `manifest.json`, run `bash scripts/build-plugin.sh`, and commit the new zip.

## Before you make this public

- **Fonts.** TAY Dumpling and TAY Sundae are commercial fonts. Check that your license covers web embedding and hosting the .woff files in a public repository. If it doesn't, make the repository private (GitHub Pages on a private repository needs a paid plan) or replace the fonts.
- **Photos.** Make sure you have the rights to every photo in `photos/`. Swap any you didn't take yourself for your own or for properly licensed ones.
- **Contact email.** The Privacy and Terms pages contain a `[CONTACT EMAIL]` placeholder. Search `index.html` for it and fill in a real address.
- **License.** There's no license file yet, which means nobody else may reuse the code. If you want people to be able to, add one. GitHub offers a picker when you create a file called `LICENSE`.
