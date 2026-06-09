import os
import shutil
import subprocess
import sys
import platform

def build():
    # 1. Compile project for UEFI
    subprocess.run(["cargo", "build", "-Z", "build-std", "--release", "--target", "x86_64-unknown-uefi"], cwd="core_os", check=True)

    # Paths
    binary_path = "core_os/target/x86_64-unknown-uefi/release/core_os.efi"
    img_name = "disk.img"

    # 2. Create directory structure for placing files (mocking FAT32 structure)
    os.makedirs("iso_root/EFI/BOOT", exist_ok=True)
    shutil.copy(binary_path, "iso_root/EFI/BOOT/BOOTX64.EFI")

    # 3. Generating a raw disk image with FAT32 layout
    if platform.system() == "Linux":
        print("[INFO] Building on Linux: Creating FAT32 disk image using dd and mtools...")
        # Create a 64MB empty image file
        subprocess.run(["dd", "if=/dev/zero", f"of={img_name}", "bs=1M", "count=64"], check=True)
        # Format the image as FAT32
        try:
            subprocess.run(["mkfs.fat", "-F", "32", img_name], check=True)
        except FileNotFoundError:
            print("[ERROR] mkfs.fat not found. Please install dosfstools.")
            sys.exit(1)

        # Use mtools to copy files into the image
        try:
            # Create EFI and BOOT directories inside the FAT32 image
            subprocess.run(["mmd", "-i", img_name, "::/EFI"], check=True)
            subprocess.run(["mmd", "-i", img_name, "::/EFI/BOOT"], check=True)
            # Copy the .efi file into the image
            subprocess.run(["mcopy", "-i", img_name, "iso_root/EFI/BOOT/BOOTX64.EFI", "::/EFI/BOOT/BOOTX64.EFI"], check=True)
            print(f"[SUCCESS] Compiled. BOOTX64.EFI is ready.")
            print(f"[SUCCESS] Final {img_name} created successfully.")
            print(f"You can now write this image to a USB flash drive or run it with QEMU.")
        except FileNotFoundError:
            print("[ERROR] mtools not found. Please install mtools.")
            sys.exit(1)
    else:
        # Cross platform / fallback instructions for Windows/Mac
        print("[WARNING] The automated .img generation using dd/mtools is only natively supported on Linux.")
        print("[SUCCESS] Compiled. BOOTX64.EFI is ready at iso_root/EFI/BOOT/BOOTX64.EFI")
        print("To create a bootable USB drive on Windows/Mac:")
        print("1. Format a USB flash drive as FAT32.")
        print("2. Copy the 'EFI' folder from 'iso_root' directly to the root of the USB drive.")
        print("3. Boot from the USB drive.")

if __name__ == "__main__":
    build()
