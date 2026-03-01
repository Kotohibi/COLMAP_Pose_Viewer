# COLMAP Pose Viewer

Browser viewer for COLMAP camera poses (`images.txt`) with image navigation, zoom/pan, and a PiP 3D camera mini-view.
## Examples
* http://kotohibi.f5.si/cv1/
* https://x.com/twitter/status/2027913310096756744

## Quick Start

1. Edit [config.json](config.json):

```json
{
  "imagesTxtPath": "colmap/sparse/0/images.txt",
  "imagesDirPath": "colmap/images",
  "navigationMode": "orbit"
}
```

2. Start a local server from the project root:

```powershell
python -m http.server 8000
```

3. Open `http://localhost:8000/`

## Controls

- Arrow keys: navigate views
- Drag (normal zoom): navigate views
- Mouse wheel: zoom
- Ctrl + mouse wheel: navigate views
- Drag (zoomed in): pan
- Double-click / double-tap: reset zoom
- Touch swipe / pinch: navigate / zoom
- PiP buttons:
  - `PiP`: show/hide
  - `Size`: small / medium / large
  - `Corner`: top-right / top-left / bottom-right / bottom-left

## Notes

- Image loading is extension-agnostic by filename stem.
- `navigationMode` supports `orbit` (default) and `local`.
- `file://` is not recommended; use a local HTTP server.

## Troubleshooting

- If images do not load, verify `config.json` paths.
- If poses load but images mismatch, confirm filename stems match COLMAP names.
