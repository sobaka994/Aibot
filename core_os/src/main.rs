#![no_std]
#![no_main]

use uefi::prelude::*;
use uefi::proto::console::gop::GraphicsOutput;
use core::ptr::write_volatile;
use noto_sans_mono_bitmap::{get_raster, FontWeight, RasterHeight};

// Название ОС: Svarog OS
// Название Утилиты: Панацея (Panacea)

#[derive(Clone, Copy, PartialEq)]
enum Language {
    Russian,
    English,
}

struct Localization {
    lang: Language,
}

impl Localization {
    fn new() -> Self {
        Self { lang: Language::Russian }
    }

    fn toggle(&mut self) {
        self.lang = match self.lang {
            Language::Russian => Language::English,
            Language::English => Language::Russian,
        };
    }

    fn get_string(&self, key: &str) -> &str {
        match key {
            "os_name" => match self.lang {
                Language::Russian => "=== Svarog OS ===",
                Language::English => "=== Svarog OS ===",
            },
            "util_name" => match self.lang {
                Language::Russian => "Утилита диагностики и восстановления: [Панацея]",
                Language::English => "Diagnostics & Recovery Utility: [Panacea]",
            },
            "diag_hw" => match self.lang {
                Language::Russian => "Запуск диагностики оборудования...",
                Language::English => "Starting hardware diagnostics...",
            },
            "diag_os" => match self.lang {
                Language::Russian => "Поиск установленных ОС...",
                Language::English => "Scanning for installed Operating Systems...",
            },
            "heal" => match self.lang {
                Language::Russian => "Попытка автоматического восстановления...",
                Language::English => "Attempting automatic recovery...",
            },
            "heal_success" => match self.lang {
                Language::Russian => "[ОК] Критические ошибки не найдены или успешно исправлены.",
                Language::English => "[OK] No critical errors found or they were successfully fixed.",
            },
            _ => "UNKNOWN_STRING",
        }
    }
}

// Simple framebuffer writer for rasterizing fonts directly to screen
struct FramebufferWriter {
    fb_ptr: *mut u32,
    pixels_width: usize,
    pixels_height: usize,
    x_pos: usize,
    y_pos: usize,
}

impl FramebufferWriter {
    fn new(fb_ptr: *mut u32, width: usize, height: usize) -> Self {
        Self {
            fb_ptr,
            pixels_width: width,
            pixels_height: height,
            x_pos: 10,
            y_pos: 10,
        }
    }

    fn draw_char(&mut self, c: char) {
        if c == '\n' {
            self.newline();
            return;
        }

        // Use noto_sans_mono_bitmap for drawing characters
        if let Some(raster) = get_raster(c, FontWeight::Regular, RasterHeight::Size16) {
            let width = raster.width();

            if self.x_pos + width >= self.pixels_width {
                self.newline();
            }

            for (y, row) in raster.raster().iter().enumerate() {
                for (x, &intensity) in row.iter().enumerate() {
                    if intensity > 0 {
                        // Create grayscale color from intensity (0-255)
                        // Make text white: 0x00FFFFFF max intensity
                        let color: u32 = (intensity as u32) | ((intensity as u32) << 8) | ((intensity as u32) << 16);

                        let offset = (self.y_pos + y) * self.pixels_width + (self.x_pos + x);
                        unsafe {
                            write_volatile(self.fb_ptr.add(offset), color);
                        }
                    }
                }
            }
            self.x_pos += width;
        } else {
            // Render a square if character not found
            let width = 8;
            if self.x_pos + width >= self.pixels_width { self.newline(); }
            for y in 0..16 {
                for x in 0..width {
                    let offset = (self.y_pos + y) * self.pixels_width + (self.x_pos + x);
                    unsafe { write_volatile(self.fb_ptr.add(offset), 0x00FF0000); } // Red block
                }
            }
            self.x_pos += width;
        }
    }

    fn draw_str(&mut self, s: &str) {
        for c in s.chars() {
            self.draw_char(c);
        }
        self.newline();
    }

    fn newline(&mut self) {
        self.x_pos = 10;
        self.y_pos += 20; // Move down 20 pixels
        if self.y_pos >= self.pixels_height {
            self.y_pos = 10; // Simple wrapping (no scrolling for MVP)
        }
    }
}

struct PanaceaUtility<'a> {
    loc: &'a Localization,
    writer: &'a mut FramebufferWriter,
}

impl<'a> PanaceaUtility<'a> {
    fn new(loc: &'a Localization, writer: &'a mut FramebufferWriter) -> Self {
        Self { loc, writer }
    }

    fn run_hardware_diagnostics(&mut self) {
        self.writer.draw_str(self.loc.get_string("diag_hw"));
    }

    fn scan_installed_os(&mut self) {
        self.writer.draw_str(self.loc.get_string("diag_os"));
    }

    fn heal_system(&mut self) {
        self.writer.draw_str(self.loc.get_string("heal"));
        self.writer.draw_str(self.loc.get_string("heal_success"));
    }

    fn run_all(&mut self) {
        self.run_hardware_diagnostics();
        self.scan_installed_os();
        self.heal_system();
    }
}

#[entry]
fn main(_image_handle: Handle, mut system_table: SystemTable<Boot>) -> Status {
    uefi_services::init(&mut system_table).unwrap();
    system_table.boot_services().set_watchdog_timer(0, 0x10000, None).unwrap();

    let bs = system_table.boot_services();

    // 1. Инициализация графики (Фреймбуфер)
    if let Ok(gop_handle) = bs.get_handle_for_protocol::<GraphicsOutput>() {
        if let Ok(mut gop) = bs.open_protocol_exclusive::<GraphicsOutput>(gop_handle) {
            if let Some(mode) = gop.modes().max_by_key(|m| m.info().resolution().0 * m.info().resolution().1) {
                let _ = gop.set_mode(&mode);

                let (width, height) = mode.info().resolution();
                let mut fb = gop.frame_buffer();
                let fb_ptr = fb.as_mut_ptr() as *mut u32;
                let pixels = fb.size() / 4;

                // Заливка темно-синим (фон)
                unsafe {
                    for i in 0..pixels {
                        write_volatile(fb_ptr.add(i), 0x0012124A);
                    }
                }

                let mut writer = FramebufferWriter::new(fb_ptr, width, height);
                let mut loc = Localization::new();

                writer.draw_str(loc.get_string("os_name"));
                writer.draw_str(loc.get_string("util_name"));

                let mut panacea = PanaceaUtility::new(&loc, &mut writer);
                panacea.run_all();

                writer.newline();
                writer.draw_str("--- Language Switched ---");
                writer.newline();

                loc.toggle();
                writer.draw_str(loc.get_string("os_name"));
                writer.draw_str(loc.get_string("util_name"));

                let mut panacea_en = PanaceaUtility::new(&loc, &mut writer);
                panacea_en.run_all();
            }
        }
    }

    loop {
        core::hint::spin_loop();
    }
}
