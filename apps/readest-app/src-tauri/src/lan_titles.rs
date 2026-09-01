//! Display-title helpers for the Home Library host.
//!
//! Mirrors `apps/readest-app/src/utils/bookTitle.ts` so the listing and the
//! PDF title overlay use the same cleaned name the desktop shelf already shows.

use serde_json::Value;
use std::path::Path;

pub fn strip_temp_prefix(name: &str) -> &str {
    for prefix in ["lan-", "gdrive-"] {
        if let Some(rest) = name.strip_prefix(prefix) {
            if let Some((digits, tail)) = rest.split_once('-') {
                if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
                    return tail.trim();
                }
            }
        }
    }
    name.trim()
}

pub fn filename_stem(path_or_name: &str) -> String {
    if path_or_name.is_empty() {
        return String::new();
    }
    let name = Path::new(path_or_name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_or_name.to_string());
    strip_temp_prefix(&name).to_string()
}

fn is_unreliable(title: &str) -> bool {
    let t = title.trim();
    if t.is_empty() {
        return true;
    }
    if !std::ptr::eq(strip_temp_prefix(t), t) && strip_temp_prefix(t) != t {
        return true;
    }
    if t != strip_temp_prefix(t) {
        return true;
    }
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("microsoft word")
        || lower == "powerpoint presentation"
        || lower.starts_with("untitled")
        || lower == "document"
        || lower.starts_with("convert jpg to pdf")
        || lower.starts_with("convert jpeg to pdf")
        || lower.starts_with("convert png to pdf")
        || lower.starts_with("convert gif to pdf")
        || lower.starts_with("convert image to pdf")
        || lower.starts_with("convert images to pdf")
    {
        return true;
    }
    looks_like_timestamp(t)
}

fn looks_like_timestamp(t: &str) -> bool {
    // `2021-11-15` or `2021-11-15 23:17` / `2021/11/15T23:17:00`
    let bytes = t.as_bytes();
    if bytes.len() < 10 {
        return false;
    }
    let ymd = |s: &[u8]| {
        s.len() >= 10
            && s[0..4].iter().all(|b| b.is_ascii_digit())
            && (s[4] == b'-' || s[4] == b'/')
            && s[5..7].iter().all(|b| b.is_ascii_digit())
            && (s[7] == b'-' || s[7] == b'/')
            && s[8..10].iter().all(|b| b.is_ascii_digit())
    };
    if !ymd(bytes) {
        return false;
    }
    if bytes.len() == 10 {
        return true;
    }
    matches!(bytes[10], b' ' | b'T') && bytes[11..].iter().all(|b| b.is_ascii_digit() || matches!(b, b':' | b' '))
}

fn prefer_filename(meta: &str, file_stem: &str, format: &str) -> bool {
    if file_stem.trim().is_empty() {
        return false;
    }
    if is_unreliable(meta) {
        return true;
    }
    if !format.eq_ignore_ascii_case("PDF") && !format.is_empty() {
        return false;
    }
    let meta = meta.trim();
    let file = file_stem.trim();
    if file.to_ascii_lowercase().contains(&meta.to_ascii_lowercase()) && file.len() > meta.len() + 6
    {
        return true;
    }
    let meta_words = meta.split_whitespace().filter(|w| !w.is_empty()).count();
    let file_words = file
        .split(|c: char| c.is_whitespace() || matches!(c, '.' | '_' | '-'))
        .filter(|w| w.len() > 1)
        .count();
    meta_words == 1 && file_words >= 3
}

/// Title the host advertises (listing + PDF overlay). Prefers a real filename
/// over scanner / Word / `lan-<ts>-` junk still sitting in library.json.
pub fn display_title(book: &Value) -> String {
    let raw = book.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let format = book.get("format").and_then(|v| v.as_str()).unwrap_or("");
    let file_stem = book
        .get("filePath")
        .and_then(|v| v.as_str())
        .map(filename_stem)
        .unwrap_or_default();
    let meta = strip_temp_prefix(raw).to_string();
    if prefer_filename(&meta, &file_stem, format) && !file_stem.is_empty() {
        return file_stem;
    }
    if !meta.is_empty() && !is_unreliable(&meta) {
        return meta;
    }
    if !file_stem.is_empty() {
        return file_stem;
    }
    meta
}

pub fn listing_filename(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy();
    let cleaned = strip_temp_prefix(&name);
    if cleaned.is_empty() {
        Some(name.into_owned())
    } else {
        Some(cleaned.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strips_lan_and_gdrive_prefixes() {
        assert_eq!(
            strip_temp_prefix("lan-1787729199808-Dying for the Truth - R. Roy Blake"),
            "Dying for the Truth - R. Roy Blake"
        );
        assert_eq!(filename_stem("C:\\Cache\\gdrive-99-Report.pdf"), "Report");
    }

    #[test]
    fn prefers_filename_over_word_and_lastname_pdf_titles() {
        let word = json!({
            "title": "Microsoft Word - index.doc",
            "format": "PDF",
            "filePath": r"C:\Books\The Hoax of the Twentieth Century.pdf",
        });
        assert_eq!(display_title(&word), "The Hoax of the Twentieth Century");

        let last = json!({
            "title": "Twyman",
            "format": "PDF",
            "filePath": r"C:\Books\GENUFLECT Secret Statues of the Templars.pdf",
        });
        assert_eq!(display_title(&last), "GENUFLECT Secret Statues of the Templars");
    }

    #[test]
    fn keeps_a_real_epub_title() {
        let book = json!({
            "title": "Chaos: Charles Manson",
            "format": "EPUB",
            "filePath": r"C:\Books\chaos.epub",
        });
        assert_eq!(display_title(&book), "Chaos: Charles Manson");
    }
}
