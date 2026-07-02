import cv2
import numpy as np

# Create a dummy blank image (500x500)
img = np.zeros((500, 500, 3), dtype=np.uint8)

# Add some fake "faces" / circles to not make it entirely blank
cv2.circle(img, (250, 250), 100, (255, 255, 255), -1)

# Save test images
import os
os.makedirs('test_images', exist_ok=True)
cv2.imwrite('test_images/test_1.jpg', img)
cv2.imwrite('test_images/test_2.jpg', img) # Add a copy to test grouping

print("Test images generated.")
