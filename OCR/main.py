import cv2
import pytesseract
import sys
import os
import re


# ============================================================
# CẤU HÌNH
# ============================================================

# Bỏ phần header phía trên ảnh.
# 0.30 = bỏ 30% chiều cao ảnh.
HEADER_RATIO = 0.30

# ============================================================
# PREPROCESS ẢNH
# ============================================================

def preprocess(image_path):

    image = cv2.imread(image_path)

    if image is None:
        raise FileNotFoundError(image_path)

    # --------------------------------------------------------
    # Phóng to
    # --------------------------------------------------------

    image = cv2.resize(
        image,
        None,
        fx=2,
        fy=2,
        interpolation=cv2.INTER_CUBIC
    )

    original_height = image.shape[0]

    # --------------------------------------------------------
    # BỎ HEADER
    # --------------------------------------------------------
    # Ví dụ:
    #
    # DANH SÁCH THÙNG HÀNG
    # PACKING LIST
    # Company
    # Shipment ID
    # Ship to
    # Order date
    # User print
    #
    # sẽ bị loại bỏ ở đây.
    # --------------------------------------------------------

    crop_y = int(original_height * HEADER_RATIO)

    image = image[crop_y:, :]

    print(
        f"Đã bỏ header: {crop_y}px"
    )

    print(
        f"Ảnh sau khi bỏ header: "
        f"{image.shape[1]}x{image.shape[0]}"
    )

    # --------------------------------------------------------
    # Gray
    # --------------------------------------------------------

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

    # --------------------------------------------------------
    # Threshold để detect đường kẻ
    # --------------------------------------------------------

    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        10
    )

    return image, gray, binary


# ============================================================
# DETECT ĐƯỜNG NGANG
# ============================================================

def detect_horizontal_lines(binary):

    """
    Tìm đường kẻ ngang của bảng.
    """

    inverted = 255 - binary

    height, width = inverted.shape

    kernel_width = max(
        50,
        width // 15
    )

    kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (kernel_width, 1)
    )

    horizontal = cv2.morphologyEx(
        inverted,
        cv2.MORPH_OPEN,
        kernel
    )

    projection = cv2.reduce(
        horizontal,
        1,
        cv2.REDUCE_SUM,
        dtype=cv2.CV_32S
    )

    projection = projection.flatten()

    threshold = width * 255 * 0.15

    lines = []

    for y, value in enumerate(projection):

        if value > threshold:
            lines.append(y)

    # --------------------------------------------------------
    # Gom Y liên tiếp thành 1 đường
    # --------------------------------------------------------

    groups = []

    if not lines:
        return groups

    start = lines[0]
    previous = lines[0]

    for y in lines[1:]:

        if y <= previous + 5:

            previous = y

        else:

            center = (
                start + previous
            ) // 2

            groups.append(center)

            start = y
            previous = y

    groups.append(
        (start + previous) // 2
    )

    return groups


# ============================================================
# FILTER ROW
# ============================================================

def filter_row_lines(lines, image_height):

    """
    Loại bỏ các đường kẻ nhỏ / không phải row.
    """

    result = []

    for i in range(len(lines)):

        if i == 0:

            result.append(
                lines[i]
            )

            continue

        distance = (
            lines[i] -
            lines[i - 1]
        )

        # Row sản phẩm thường cao >= 40px
        if distance >= 40:

            result.append(
                lines[i]
            )

    return result


# ============================================================
# PREPROCESS OCR ROW
# ============================================================

def preprocess_ocr_row(image):

    """
    Chuẩn bị ảnh crop trước khi OCR.
    """

    # Phóng to thêm
    image = cv2.resize(
        image,
        None,
        fx=2,
        fy=2,
        interpolation=cv2.INTER_CUBIC
    )

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

    # Làm sạch nhẹ
    gray = cv2.GaussianBlur(
        gray,
        (3, 3),
        0
    )

    # Threshold
    binary = cv2.threshold(
        gray,
        0,
        255,
        cv2.THRESH_BINARY +
        cv2.THRESH_OTSU
    )[1]

    # Remove table borders before OCR so vertical rules are not read as '|'.
    vertical_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (1, max(20, binary.shape[0] // 3))
    )

    vertical_lines = cv2.morphologyEx(
        255 - binary,
        cv2.MORPH_OPEN,
        vertical_kernel
    )

    binary[vertical_lines > 0] = 255

    return binary


# ============================================================
# OCR ROW
# ============================================================

def ocr_region(image):

    """
    OCR một row.
    """

    processed = preprocess_ocr_row(
        image
    )

    config = r"--oem 3 --psm 6"

    text = pytesseract.image_to_string(
        processed,
        lang="eng+vie",
        config=config
    )

    lines = []

    for line in text.splitlines():

        line = line.strip()

        if not line:
            continue

        # Gom khoảng trắng
        line = " ".join(
            line.split()
        )

        lines.append(line)

    return lines


# ============================================================
# CROP + OCR TỪNG ROW
# ============================================================

def process_rows(image, lines):

    """
    Crop từng row dựa vào đường kẻ ngang
    và OCR trực tiếp từng row.
    """

    rows = []

    for i in range(
        len(lines) - 1
    ):

        y1 = lines[i]
        y2 = lines[i + 1]

        # Bỏ vùng quá nhỏ
        if y2 - y1 < 40:
            continue

        # Cách đường kẻ một chút
        top = y1 + 5
        bottom = y2 - 5

        crop = image[
            top:bottom,
            :
        ]

        # OCR
        text = ocr_region(
            crop
        )

        # Product rows start with the numeric sequence column.
        has_sequence_number = any(
            re.match(r"^\d{1,4}\b", line)
            for line in text
        )

        if not has_sequence_number:
            continue

        if text:

            rows.append({
                "index": len(rows) + 1,
                "y1": y1,
                "y2": y2,
                "text": text,
                "image": crop
            })

    return rows


# ============================================================
# SAVE DEBUG ROWS
# ============================================================

def save_debug_rows(rows):

    os.makedirs(
        "ocr_rows",
        exist_ok=True
    )

    for row in rows:

        path = os.path.join(
            "ocr_rows",
            f"row_{row['index']:02d}.png"
        )

        cv2.imwrite(
            path,
            row["image"]
        )


# ============================================================
# SAVE TEXT
# ============================================================

def save_text(rows):

    with open(
        "ocr_rows.txt",
        "w",
        encoding="utf-8"
    ) as f:

        for row in rows:

            f.write(
                f"ROW {row['index']}\n"
            )

            f.write(
                "-" * 100 +
                "\n"
            )

            for line in row["text"]:

                f.write(
                    line + "\n"
                )

            f.write("\n")

    print(
        "Đã lưu OCR: ocr_rows.txt"
    )


# ============================================================
# MAIN
# ============================================================

def main():

    if len(sys.argv) < 2:

        print("Usage:")
        print(
            "python ocr_rows.py image.jpg"
        )

        return

    image_path = sys.argv[1]

    # ========================================================
    # PREPROCESS
    # ========================================================

    image, gray, binary = preprocess(
        image_path
    )

    # ========================================================
    # TÌM ĐƯỜNG NGANG
    # ========================================================

    lines = detect_horizontal_lines(
        binary
    )

    print(
        f"Detected horizontal lines: "
        f"{len(lines)}"
    )

    lines = filter_row_lines(
        lines,
        image.shape[0]
    )

    print(
        f"Filtered row lines: "
        f"{len(lines)}"
    )

    # ========================================================
    # CROP + OCR
    # ========================================================

    rows = process_rows(
        image,
        lines
    )

    # ========================================================
    # SAVE ROW IMAGES
    # ========================================================

    save_debug_rows(
        rows
    )

    # ========================================================
    # SAVE TEXT
    # ========================================================

    save_text(
        rows
    )

    # ========================================================
    # OUTPUT
    # ========================================================

    print()

    print(
        "=" * 100
    )

    print(
        "OCR THEO ROW"
    )

    print(
        "=" * 100
    )

    for row in rows:

        print()

        print(
            f"ROW {row['index']}"
        )

        print(
            "-" * 100
        )

        for line in row["text"]:

            print(line)

    print()

    print(
        f"Đã tạo {len(rows)} row."
    )

    print(
        "Ảnh từng row: ocr_rows/"
    )

    print(
        "Text OCR: ocr_rows.txt"
    )


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":

    main()