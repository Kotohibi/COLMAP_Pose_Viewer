"""
マスク画像を基に画像をクリッピングしてベース画像にコンポジットするツール

config.txt で設定を読み込み、CLIオプションは不要。
"""

import os
import sys
from pathlib import Path
from PIL import Image

# ---------- 設定読み込み ----------

def load_config(config_path: str = None) -> dict:
    """config.txt を読み込んで辞書で返す"""
    if config_path is None:
        config_path = Path(__file__).parent / "config.txt"
    else:
        config_path = Path(config_path)

    if not config_path.exists():
        print(f"[ERROR] 設定ファイルが見つかりません: {config_path}")
        sys.exit(1)

    config = {}
    with open(config_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            config[key.strip()] = value.strip()
    return config


def parse_color(color_str: str) -> tuple:
    """'R, G, B' 文字列を (R, G, B) タプルに変換"""
    parts = [int(c.strip()) for c in color_str.split(",")]
    if len(parts) != 3:
        raise ValueError(f"色の指定が不正です (R,G,B の3値が必要): {color_str}")
    return tuple(parts)


def parse_output_size(size_str: str):
    """出力解像度設定を解釈する。'original' または 'WIDTHxHEIGHT' を受け付ける。"""
    text = (size_str or "original").strip().lower()
    if text in ("", "original", "source", "input"):
        return None

    normalized = text.replace("*", "x").replace(",", "x")
    if "x" not in normalized:
        raise ValueError(f"output_size の形式が不正です: {size_str} (例: 1920x1080)")

    width_text, height_text = normalized.split("x", 1)
    width = int(width_text.strip())
    height = int(height_text.strip())
    if width <= 0 or height <= 0:
        raise ValueError(f"output_size は正の整数で指定してください: {size_str}")
    return (width, height)


def parse_jpeg_quality(quality_str: str) -> int:
    """JPEG品質を 1-100 で解釈する。未指定時は 95。"""
    text = (quality_str or "95").strip()
    quality = int(text)
    if quality < 1 or quality > 100:
        raise ValueError(f"jpeg_quality は 1-100 の範囲で指定してください: {quality_str}")
    return quality


def parse_center_crop_size(size_str: str):
    """中心クロップサイズを解釈する。'none' または 'WIDTHxHEIGHT' を受け付ける。"""
    text = (size_str or "none").strip().lower()
    if text in ("", "none", "off", "disable", "false"):
        return None

    normalized = text.replace("*", "x").replace(",", "x")
    if "x" not in normalized:
        raise ValueError(f"center_crop_size の形式が不正です: {size_str} (例: 1024x1024)")

    width_text, height_text = normalized.split("x", 1)
    width = int(width_text.strip())
    height = int(height_text.strip())
    if width <= 0 or height <= 0:
        raise ValueError(f"center_crop_size は正の整数で指定してください: {size_str}")
    return (width, height)


def parse_crop_center_shift(shift_str: str):
    """中心クロップの中心点シフトを解釈する。'x,y' 形式（単位: px）。"""
    text = (shift_str or "0,0").strip().lower()
    if text in ("", "none", "off"):
        return (0, 0)

    normalized = text.replace("x", ",")
    parts = [p.strip() for p in normalized.split(",") if p.strip() != ""]
    if len(parts) != 2:
        raise ValueError(f"crop_center_shift の形式が不正です: {shift_str} (例: 120,-80)")

    shift_x = int(parts[0])
    shift_y = int(parts[1])
    return (shift_x, shift_y)


# ---------- 画像処理 ----------

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


def collect_images(folder: Path) -> dict:
    """フォルダ内の画像を {拡張子なしファイル名: パス} の辞書で返す"""
    result = {}
    for p in sorted(folder.iterdir()):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
            stem = p.stem
            result[stem] = p
    return result


def create_base_image(size: tuple, color: tuple) -> Image.Image:
    """指定サイズ・色のベース画像 (RGBA) を生成"""
    base = Image.new("RGBA", size, (*color, 255))
    return base


def clip_and_composite(image: Image.Image, mask: Image.Image, base: Image.Image) -> Image.Image:
    """
    マスクを使って入力画像をクリッピングし、ベース画像にコンポジットする。
    マスクの白い部分が残る領域。
    """
    # Convert image to RGBA
    image = image.convert("RGBA")
    # Convert mask to grayscale
    mask_gray = mask.convert("L")

    # Resize mask if its size differs from the image size
    if mask_gray.size != image.size:
        print(f"  [WARN] マスクサイズ {mask_gray.size} を画像サイズ {image.size} にリサイズします")
        mask_gray = mask_gray.resize(image.size, Image.LANCZOS)

    # Apply mask as alpha channel to the input image
    clipped = Image.new("RGBA", image.size, (0, 0, 0, 0))
    clipped.paste(image, mask=mask_gray)

    # Composite onto the base image
    result = base.copy()
    if result.size != clipped.size:
        result = result.resize(clipped.size, Image.LANCZOS)
    result = Image.alpha_composite(result, clipped)

    return result


def rotate_image(image: Image.Image, angle: int) -> Image.Image:
    """90° 単位で画像を回転 (0, 90, 180, 270)"""
    angle = angle % 360
    if angle == 0:
        return image
    elif angle == 90:
        return image.transpose(Image.ROTATE_90)
    elif angle == 180:
        return image.transpose(Image.ROTATE_180)
    elif angle == 270:
        return image.transpose(Image.ROTATE_270)
    else:
        print(f"  [WARN] 回転角度 {angle} は 90° 単位ではありません。0° として扱います。")
        return image


def center_crop_pair(image: Image.Image, mask: Image.Image, crop_size: tuple, center_shift: tuple):
    """画像とマスクを同じ中心矩形でクロップする。center_shift は中心からの移動量(px)。"""
    if mask.size != image.size:
        print(f"  [WARN] クロップ前にマスクサイズ {mask.size} を画像サイズ {image.size} にリサイズします")
        mask = mask.resize(image.size, Image.LANCZOS)

    img_w, img_h = image.size
    crop_w = min(crop_size[0], img_w)
    crop_h = min(crop_size[1], img_h)

    if (crop_w, crop_h) != crop_size:
        print(f"  [WARN] center_crop_size {crop_size[0]}x{crop_size[1]} は入力サイズを超えるため {crop_w}x{crop_h} に調整します")

    base_left = (img_w - crop_w) // 2
    base_top = (img_h - crop_h) // 2

    shift_x, shift_y = center_shift
    left = base_left + shift_x
    top = base_top + shift_y

    max_left = img_w - crop_w
    max_top = img_h - crop_h
    left = max(0, min(left, max_left))
    top = max(0, min(top, max_top))

    right = left + crop_w
    bottom = top + crop_h

    return image.crop((left, top, right, bottom)), mask.crop((left, top, right, bottom))


# ---------- メイン処理 ----------

def main():
    print("=" * 50)
    print("マスククリッピング ツール")
    print("=" * 50)

    # Load configuration
    config = load_config()

    script_dir = Path(__file__).parent
    image_folder = Path(config.get("image_folder", "./input_images"))
    mask_folder  = Path(config.get("mask_folder", "./input_masks"))
    output_folder = Path(config.get("output_folder", "./output"))

    # Resolve relative paths against script_dir
    if not image_folder.is_absolute():
        image_folder = script_dir / image_folder
    if not mask_folder.is_absolute():
        mask_folder = script_dir / mask_folder
    if not output_folder.is_absolute():
        output_folder = script_dir / output_folder

    base_color = parse_color(config.get("base_color", "0, 0, 0"))
    rotation   = int(config.get("rotation", "0"))
    output_fmt = config.get("output_format", "png").lower()
    output_size = parse_output_size(config.get("output_size", "original"))
    jpeg_quality = parse_jpeg_quality(config.get("jpeg_quality", "95"))
    center_crop_size = parse_center_crop_size(config.get("center_crop_size", "none"))
    crop_center_shift = parse_crop_center_shift(config.get("crop_center_shift", "0,0"))

    print(f"\n[設定]")
    print(f"  画像フォルダ : {image_folder}")
    print(f"  マスクフォルダ: {mask_folder}")
    print(f"  出力フォルダ : {output_folder}")
    print(f"  ベース色     : RGB{base_color}")
    print(f"  回転角度     : {rotation}°")
    print(f"  出力形式     : {output_fmt}")
    print(f"  出力解像度   : {output_size[0]}x{output_size[1]}" if output_size else "  出力解像度   : original")
    print(f"  中心クロップ : {center_crop_size[0]}x{center_crop_size[1]}" if center_crop_size else "  中心クロップ : none")
    print(f"  クロップシフト: {crop_center_shift[0]},{crop_center_shift[1]} px")
    if output_fmt in ("jpg", "jpeg"):
        print(f"  JPEG品質     : {jpeg_quality}")

    # Check folder existence
    if not image_folder.exists():
        print(f"\n[ERROR] 画像フォルダが存在しません: {image_folder}")
        sys.exit(1)
    if not mask_folder.exists():
        print(f"\n[ERROR] マスクフォルダが存在しません: {mask_folder}")
        sys.exit(1)

    output_folder.mkdir(parents=True, exist_ok=True)

    # Collect images and masks
    images = collect_images(image_folder)
    masks  = collect_images(mask_folder)

    if not images:
        print(f"\n[ERROR] 画像フォルダに画像がありません: {image_folder}")
        sys.exit(1)

    # Match files by same stem (ignore extension)
    matched = []
    for stem, img_path in images.items():
        if stem in masks:
            matched.append((stem, img_path, masks[stem]))

    if not matched:
        print(f"\n[ERROR] 画像とマスクで同名のファイルが見つかりません。")
        print(f"  画像: {list(images.keys())[:5]} ...")
        print(f"  マスク: {list(masks.keys())[:5]} ...")
        sys.exit(1)

    print(f"\n[処理] {len(matched)} 組の画像-マスクペアを処理します\n")

    success = 0
    for stem, img_path, mask_path in matched:
        try:
            print(f"  処理中: {stem}")

            # Load image files
            img = Image.open(img_path)
            mask = Image.open(mask_path)

            # Apply center crop
            if center_crop_size is not None:
                img, mask = center_crop_pair(img, mask, center_crop_size, crop_center_shift)

            # Generate base image (same size as input image)
            base = create_base_image(img.size, base_color)

            # Clip and composite
            result = clip_and_composite(img, mask, base)

            # Rotate
            if rotation != 0:
                result = rotate_image(result, rotation)

            # Apply output resolution if specified
            if output_size is not None and result.size != output_size:
                result = result.resize(output_size, Image.LANCZOS)

            # Save output
            out_name = f"{stem}.{output_fmt}"
            out_path = output_folder / out_name

            # JPEG は RGBA 非対応なので RGB に変換
            save_kwargs = {}
            if output_fmt in ("jpg", "jpeg"):
                result = result.convert("RGB")
                save_kwargs = {"quality": jpeg_quality}

            result.save(out_path, **save_kwargs)
            print(f"    -> {out_path}")
            success += 1

        except Exception as e:
            print(f"    [ERROR] {stem}: {e}")

    print(f"\n[完了] {success}/{len(matched)} 枚を処理しました。")
    print(f"出力先: {output_folder}")


if __name__ == "__main__":
    main()
