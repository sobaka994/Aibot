import os
import shutil
import subprocess
import sys

def build():
    subprocess.run(["cargo", "build", "-Z", "build-std", "--release", "--target", "x86_64-unknown-uefi"], cwd="core_os", check=True)

    binary_path = "core_os/target/x86_64-unknown-uefi/release/core_os.efi"
    img_name = "disk.img"

    os.makedirs("iso_root/EFI/BOOT", exist_ok=True)
    shutil.copy(binary_path, "iso_root/EFI/BOOT/BOOTX64.EFI")

    print("[INFO] Creating FAT32 disk image...")
    subprocess.run(["dd", "if=/dev/zero", f"of={img_name}", "bs=1M", "count=64"], check=True)
    try:
        subprocess.run(["mkfs.fat", "-F", "32", img_name], check=True)
    except FileNotFoundError:
        print("[ERROR] mkfs.fat not found.")
        sys.exit(1)

    try:
        subprocess.run(["mmd", "-i", img_name, "::/EFI"], check=True)
        subprocess.run(["mmd", "-i", img_name, "::/EFI/BOOT"], check=True)
        subprocess.run(["mcopy", "-i", img_name, "iso_root/EFI/BOOT/BOOTX64.EFI", "::/EFI/BOOT/BOOTX64.EFI"], check=True)
    except FileNotFoundError:
        print("[ERROR] mtools not found.")
        sys.exit(1)

    print(f"[SUCCESS] Compiled. BOOTX64.EFI is ready.")
    print(f"[SUCCESS] Final {img_name} created successfully.")

if __name__ == "__main__":
    build()
