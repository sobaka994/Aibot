import argparse
import os
import cv2
import csv
import mediapipe as mp
import math
import imagehash
from PIL import Image

mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    static_image_mode=True,
    max_num_faces=5,
    refine_landmarks=True,
    min_detection_confidence=0.5
)

# Constants for eye landmarks
LEFT_EYE_TOP = 159
LEFT_EYE_BOTTOM = 145
LEFT_EYE_LEFT = 33
LEFT_EYE_RIGHT = 133

RIGHT_EYE_TOP = 386
RIGHT_EYE_BOTTOM = 374
RIGHT_EYE_LEFT = 362
RIGHT_EYE_RIGHT = 263

def euclidean_distance(p1, p2, img_width, img_height):
    x1, y1 = p1.x * img_width, p1.y * img_height
    x2, y2 = p2.x * img_width, p2.y * img_height
    return math.hypot(x2 - x1, y2 - y1)

def eye_aspect_ratio(landmarks, eye_indices, img_width, img_height):
    # Vertical distances
    v1 = euclidean_distance(landmarks[eye_indices['top']], landmarks[eye_indices['bottom']], img_width, img_height)
    # Horizontal distance
    h1 = euclidean_distance(landmarks[eye_indices['left']], landmarks[eye_indices['right']], img_width, img_height)

    if h1 == 0:
        return 0.0
    return v1 / h1

def detect_faces_and_eyes(image):
    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb_image)

    faces_data = []

    if results.multi_face_landmarks:
        img_height, img_width, _ = image.shape
        for face_landmarks in results.multi_face_landmarks:
            landmarks = face_landmarks.landmark

            left_eye_indices = {'top': LEFT_EYE_TOP, 'bottom': LEFT_EYE_BOTTOM, 'left': LEFT_EYE_LEFT, 'right': LEFT_EYE_RIGHT}
            right_eye_indices = {'top': RIGHT_EYE_TOP, 'bottom': RIGHT_EYE_BOTTOM, 'left': RIGHT_EYE_LEFT, 'right': RIGHT_EYE_RIGHT}

            left_ear = eye_aspect_ratio(landmarks, left_eye_indices, img_width, img_height)
            right_ear = eye_aspect_ratio(landmarks, right_eye_indices, img_width, img_height)

            # Simple threshold for closed eyes, typically EAR < 0.2 means closed
            EAR_THRESHOLD = 0.2
            eyes_closed = (left_ear < EAR_THRESHOLD) or (right_ear < EAR_THRESHOLD)

            faces_data.append({
                'left_ear': left_ear,
                'right_ear': right_ear,
                'eyes_closed': eyes_closed
            })

    return faces_data

def variance_of_laplacian(image):
    """Computes the Laplacian of the image and returns the variance (blur metric)."""
    return cv2.Laplacian(image, cv2.CV_64F).var()

def evaluate_image(filepath):
    """Evaluates an image for blur, face/eye data, and computes a perceptual hash."""
    image = cv2.imread(filepath)
    if image is None:
        return None

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    fm = variance_of_laplacian(gray)

    faces = detect_faces_and_eyes(image)

    # Calculate a simple penalty if any face has closed eyes
    closed_eyes_penalty = 0
    if len(faces) > 0:
        if any(face['eyes_closed'] for face in faces):
            closed_eyes_penalty = 1

    # Compute perceptual hash using PIL
    pil_image = Image.open(filepath)
    img_hash = imagehash.phash(pil_image)

    return {
        'filepath': filepath,
        'filename': os.path.basename(filepath),
        'blur_score': fm,
        'num_faces': len(faces),
        'closed_eyes': closed_eyes_penalty > 0,
        'hash': img_hash
    }

def group_similar_images(results, hash_threshold=10):
    """Groups images that are perceptually similar based on Hamming distance."""
    groups = []

    for result in results:
        placed = False
        for group in groups:
            # Compare with the first item in the group
            if result['hash'] - group[0]['hash'] <= hash_threshold:
                group.append(result)
                placed = True
                break
        if not placed:
            groups.append([result])

    return groups

def main():
    parser = argparse.ArgumentParser(description="Smart Cull: Автоматический анализ и отбор фотографий.")
    parser.add_argument("directory", help="Путь к директории с изображениями для анализа.")
    parser.add_argument("--output", default="cull_results.csv", help="Имя выходного CSV файла.")

    args = parser.parse_args()

    if not os.path.isdir(args.directory):
        print(f"Ошибка: {args.directory} не является директорией.")
        return

    supported_extensions = ('.jpg', '.jpeg', '.png')
    results = []

    print(f"Сканирование директории: {args.directory}")
    for filename in os.listdir(args.directory):
        if filename.lower().endswith(supported_extensions):
            filepath = os.path.join(args.directory, filename)
            result = evaluate_image(filepath)
            if result:
                results.append(result)
                print(f"Проанализирован {filename}: Резкость={result['blur_score']:.2f}, Лица={result['num_faces']}, Закрытые глаза={result['closed_eyes']}")

    # Group similar images
    groups = group_similar_images(results)
    print(f"\nНайдено {len(groups)} уникальных групп/серий кадров.")

    final_cull = []
    for group in groups:
        if len(group) == 1:
            # Only one image in group
            img = group[0]
            rating = 5 if not img['closed_eyes'] and img['blur_score'] > 100 else 1
            color = "Green" if rating == 5 else "Red"
            final_cull.append({
                'filename': img['filename'],
                'rating': rating,
                'color': color
            })
        else:
            # Multiple images, pick the best one
            # Score formula: blur_score * (0.1 if closed_eyes else 1.0) * (1.5 if faces > 0 else 1.0)
            def score_func(img):
                score = img['blur_score']
                if img['closed_eyes']:
                    score *= 0.1
                if img['num_faces'] > 0:
                    score *= 1.5
                return score

            group.sort(key=score_func, reverse=True)
            best_img = group[0]

            for img in group:
                if img['filename'] == best_img['filename']:
                    rating = 5 if not img['closed_eyes'] and img['blur_score'] > 100 else 0
                    color = "Green" if rating == 5 else "Yellow"
                else:
                    rating = 1
                    color = "Red"

                final_cull.append({
                    'filename': img['filename'],
                    'rating': rating,
                    'color': color
                })

    # Write CSV
    with open(args.output, 'w', newline='') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(['filename', 'rating', 'color'])
        for item in final_cull:
            writer.writerow([item['filename'], item['rating'], item['color']])

    print(f"\nРезультаты сохранены в {args.output}")

if __name__ == "__main__":
    main()
