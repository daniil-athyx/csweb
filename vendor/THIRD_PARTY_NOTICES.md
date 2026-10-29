# Vendored dependencies

- `xash3d-fwgs` 1.2.2: Xash3D-FWGS Emscripten runtime and WebAssembly files.
  The package metadata declares MIT; source: <https://github.com/yohimik/webxash3d-fwgs>.
- `jszip` 3.10.1: MIT; see [`jszip/LICENSE.markdown`](./jszip/LICENSE.markdown).
- `cs16.css`: MIT; see [`cs16.css/LICENSE`](./cs16.css/LICENSE). Its bundled
  `ArialPixel.ttf` font is served locally by the vendored stylesheet.

The CS client WebAssembly modules and `extras.pk3` are still fetched from the
upstream `cs16-client` CDN; they are not included in this repository.
