import os
import shutil
import subprocess

def build():
    # 1. Compile project for UEFI
    subprocess.run(["cargo", "build", "-Z", "build-std", "--release", "--target", "x86_64-unknown-uefi"], cwd="core_os", check=True)

    # Paths
    binary_path = "core_os/target/x86_64-unknown-uefi/release/core_os.efi"
    img_name = "disk.img"

    # 2. Create directory structure for placing files (mocking FAT32 structure)
    os.makedirs("iso_root/EFI/BOOT", exist_ok=True)
    shutil.copy(binary_path, "iso_root/EFI/BOOT/BOOTX64.EFI")

    # 3. Generating a raw disk image with FAT32 layout (requires mtools or dd+mkfs.vfat)
    # For Windows/Linux/Mac universal approach through dd can be used:
    print(f"[SUCCESS] Compiled. BOOTX64.EFI is ready.")
    print(f"To create the final .img disk, transfer BOOTX64.EFI to a FAT32 flash drive in the /EFI/BOOT/ directory")

if __name__ == "__main__":
    build()
