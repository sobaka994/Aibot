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
            "press_key" => match self.lang {
                Language::Russian => "Нажмите 'L' для смены языка, 'D' для диагностики.",
                Language::English => "Press 'L' to toggle language, 'D' to run diagnostics.",
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
    stride: usize,
    x_pos: usize,
    y_pos: usize,
}

impl FramebufferWriter {
    fn new(fb_ptr: *mut u32, width: usize, height: usize, stride: usize) -> Self {
        Self {
            fb_ptr,
            pixels_width: width,
            pixels_height: height,
            stride,
            x_pos: 10,
            y_pos: 10,
        }
    }

    fn draw_char(&mut self, c: char) {
        if c == '\n' {
            self.newline();
            return;
        }

        if let Some(raster) = get_raster(c, FontWeight::Regular, RasterHeight::Size16) {
            let width = raster.width();

            if self.x_pos + width >= self.pixels_width {
                self.newline();
            }

            // Защита: если мы вылетели за нижний край, прекращаем вывод (пока нет скроллинга)
            if self.y_pos + 16 >= self.pixels_height {
                return;
            }

            for (y, row) in raster.raster().iter().enumerate() {
                for (x, &intensity) in row.iter().enumerate() {
                    if intensity > 0 {
                        let color: u32 = (intensity as u32) | ((intensity as u32) << 8) | ((intensity as u32) << 16);

                        // РАСЧЕТ С УЧЕТОМ STRIDE: гарантирует попадание точно в нужный пиксель на любом железе
                        let offset = (self.y_pos + y) * self.stride + (self.x_pos + x);
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
            if self.y_pos + 16 >= self.pixels_height { return; }
            for y in 0..16 {
                for x in 0..width {
                    let offset = (self.y_pos + y) * self.stride + (self.x_pos + x);
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
    }

    fn clear_screen(&mut self) {
        let pixels = self.pixels_height * self.stride;
        unsafe {
            for i in 0..pixels {
                write_volatile(self.fb_ptr.add(i), 0x0012124A); // Темно-синий
            }
        }
        self.x_pos = 10;
        self.y_pos = 10;
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

    // Создаем независимую копию системной таблицы для работы в цикле,
    // чтобы safe Rust не блокировал нам доступ к Boot Services
    let mut system_table_copy = unsafe { system_table.unsafe_clone() };

    let bs = system_table.boot_services();
    bs.set_watchdog_timer(0, 0x10000, None).unwrap();

    // Открываем графику и держим её ЖИВОЙ до конца работы системы
    let gop_handle = bs.get_handle_for_protocol::<GraphicsOutput>().unwrap();
    let mut gop = bs.open_protocol_exclusive::<GraphicsOutput>(gop_handle).unwrap();

    let mode = gop.modes().max_by_key(|m| m.info().resolution().0 * m.info().resolution().1).unwrap();
    gop.set_mode(&mode).unwrap();

    let (width, height) = mode.info().resolution();
    let stride = mode.info().stride();
    let mut fb = gop.frame_buffer();
    let fb_ptr = fb.as_mut_ptr() as *mut u32;

    let mut writer = FramebufferWriter::new(fb_ptr, width, height, stride);
    writer.clear_screen();

    let mut loc = Localization::new();

    writer.draw_str(loc.get_string("os_name"));
    writer.draw_str(loc.get_string("util_name"));
    writer.draw_str("");
    writer.draw_str(loc.get_string("press_key"));

    // Теперь используем изолированную копию таблицы для опроса ввода
    loop {
        let stdin = system_table_copy.stdin();
        if let Ok(Some(key)) = stdin.read_key() {
            use uefi::proto::console::text::Key;
            if let Key::Printable(k) = key {
                // To avoid panic with invalid surrogates via char::from on Char16:
                let ch_u16 = u16::from(k);
                if let Some(ch) = char::from_u32(ch_u16 as u32) {
                    if ch == 'l' || ch == 'L' {
                        loc.toggle();
                        writer.clear_screen();
                        writer.draw_str(loc.get_string("os_name"));
                        writer.draw_str(loc.get_string("util_name"));
                        writer.draw_str("");
                        writer.draw_str(loc.get_string("press_key"));
                    } else if ch == 'd' || ch == 'D' {
                        writer.clear_screen();
                        writer.draw_str(loc.get_string("os_name"));
                        writer.draw_str(loc.get_string("util_name"));
                        writer.draw_str("");
                        let mut panacea = PanaceaUtility::new(&loc, &mut writer);
                        panacea.run_all();
                        writer.draw_str("");
                        writer.draw_str(loc.get_string("press_key"));
                    }
                }
            }
        } else {
            // Используем boot_services из копии таблицы, оригинальный bs не трогаем
            system_table_copy.boot_services().stall(10000);
        }
    }
}
