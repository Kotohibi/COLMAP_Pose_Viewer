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
    # 画像を RGBA に変換
    image = image.convert("RGBA")
    # マスクをグレースケールに変換
    mask_gray = mask.convert("L")

    # マスクサイズと画像サイズが異なる場合はマスクをリサイズ
    if mask_gray.size != image.size:
        print(f"  [WARN] マスクサイズ {mask_gray.size} を画像サイズ {image.size} にリサイズします")
        mask_gray = mask_gray.resize(image.size, Image.LANCZOS)

    # 入力画像にマスクをアルファとして適用
    clipped = Image.new("RGBA", image.size, (0, 0, 0, 0))
    clipped.paste(image, mask=mask_gray)

    # ベース画像にコンポジット
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


# ---------- メイン処理 ----------

def main():
    print("=" * 50)
    print("マスククリッピング ツール")
    print("=" * 50)

    # 設定読み込み
    config = load_config()

    script_dir = Path(__file__).parent
    image_folder = Path(config.get("image_folder", "./input_images"))
    mask_folder  = Path(config.get("mask_folder", "./input_masks"))
    output_folder = Path(config.get("output_folder", "./output"))

    # 相対パスの場合は script_dir 基準にする
    if not image_folder.is_absolute():
        image_folder = script_dir / image_folder
    if not mask_folder.is_absolute():
        mask_folder = script_dir / mask_folder
    if not output_folder.is_absolute():
        output_folder = script_dir / output_folder

    base_color = parse_color(config.get("base_color", "0, 0, 0"))
    rotation   = int(config.get("rotation", "0"))
    output_fmt = config.get("output_format", "png").lower()

    print(f"\n[設定]")
    print(f"  画像フォルダ : {image_folder}")
    print(f"  マスクフォルダ: {mask_folder}")
    print(f"  出力フォルダ : {output_folder}")
    print(f"  ベース色     : RGB{base_color}")
    print(f"  回転角度     : {rotation}°")
    print(f"  出力形式     : {output_fmt}")

    # フォルダ存在チェック
    if not image_folder.exists():
        print(f"\n[ERROR] 画像フォルダが存在しません: {image_folder}")
        sys.exit(1)
    if not mask_folder.exists():
        print(f"\n[ERROR] マスクフォルダが存在しません: {mask_folder}")
        sys.exit(1)

    output_folder.mkdir(parents=True, exist_ok=True)

    # 画像・マスクを収集
    images = collect_images(image_folder)
    masks  = collect_images(mask_folder)

    if not images:
        print(f"\n[ERROR] 画像フォルダに画像がありません: {image_folder}")
        sys.exit(1)

    # 同名マッチング (拡張子無視)
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

            # 画像読み込み
            img = Image.open(img_path)
            mask = Image.open(mask_path)

            # ベース画像生成 (入力画像と同じサイズ)
            base = create_base_image(img.size, base_color)

            # クリッピング & コンポジット
            result = clip_and_composite(img, mask, base)

            # 回転
            if rotation != 0:
                result = rotate_image(result, rotation)

            # 出力
            out_name = f"{stem}.{output_fmt}"
            out_path = output_folder / out_name

            # JPEG は RGBA 非対応なので RGB に変換
            if output_fmt in ("jpg", "jpeg"):
                result = result.convert("RGB")

            result.save(out_path)
            print(f"    -> {out_path}")
            success += 1

        except Exception as e:
            print(f"    [ERROR] {stem}: {e}")

    print(f"\n[完了] {success}/{len(matched)} 枚を処理しました。")
    print(f"出力先: {output_folder}")


if __name__ == "__main__":
    main()
