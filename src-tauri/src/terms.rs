// ==========================================
// Date & Terms Helpers (Pure integer arithmetic, YYYY-MM-DD)
// Neutral module for due date calculation (Issue #219)
// ==========================================

pub fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

pub fn get_days_in_month(year: i32, month: u32) -> u32 {
    match month {
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

pub fn add_days(mut year: i32, mut month: u32, day: u32, days_to_add: u32) -> (i32, u32, u32) {
    let mut d = day + days_to_add;
    loop {
        let dim = get_days_in_month(year, month);
        if d <= dim {
            break;
        }
        d -= dim;
        month += 1;
        if month > 12 {
            month = 1;
            year += 1;
        }
    }
    (year, month, d)
}

pub fn parse_date(date_str: &str) -> Result<(i32, u32, u32), String> {
    let trimmed = date_str.trim();
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return Err("日期格式需為 YYYY-MM-DD".to_string());
    }
    let year: i32 = parts[0].parse().map_err(|_| "無效的年份".to_string())?;
    let month: u32 = parts[1].parse().map_err(|_| "無效的月份".to_string())?;
    let day: u32 = parts[2].parse().map_err(|_| "無效的日期".to_string())?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err("無效的日期數值".to_string());
    }
    let dim = get_days_in_month(year, month);
    if day > dim {
        return Err("日期超出該月份天數".to_string());
    }
    Ok((year, month, day))
}

pub fn format_date(year: i32, month: u32, day: u32) -> String {
    format!("{:04}-{:02}-{:02}", year, month, day)
}

/// Calculate due date based on document date, terms type and terms days.
/// Neutral function used by both Accounts Payable and Accounts Receivable.
pub fn calculate_due_date(
    doc_date: &str,
    terms_type: Option<&str>,
    terms_days: Option<i64>,
) -> Result<String, String> {
    let (year, month, day) = parse_date(doc_date)?;
    let t_type = match terms_type {
        Some(t) => t.trim(),
        None => return Ok(doc_date.trim().to_string()),
    };
    if t_type.is_empty() {
        return Ok(doc_date.trim().to_string());
    }

    let days = terms_days.unwrap_or(0).max(0) as u32;

    match t_type {
        "net" => {
            let (y, m, d) = add_days(year, month, day, days);
            Ok(format_date(y, m, d))
        }
        "month_end" => {
            let end_day = get_days_in_month(year, month);
            let (y, m, d) = add_days(year, month, end_day, days);
            Ok(format_date(y, m, d))
        }
        _ => Ok(doc_date.trim().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_due_date_net() {
        assert_eq!(
            calculate_due_date("2026-01-15", Some("net"), Some(30)).unwrap(),
            "2026-02-14"
        );
        assert_eq!(
            calculate_due_date("2026-01-15", Some("net"), Some(0)).unwrap(),
            "2026-01-15"
        );
    }

    #[test]
    fn test_calculate_due_date_month_end() {
        assert_eq!(
            calculate_due_date("2026-01-15", Some("month_end"), Some(30)).unwrap(),
            "2026-03-02"
        );
        assert_eq!(
            calculate_due_date("2026-01-15", Some("month_end"), Some(0)).unwrap(),
            "2026-01-31"
        );
    }

    #[test]
    fn test_calculate_due_date_unconfigured() {
        assert_eq!(
            calculate_due_date("2026-01-15", None, None).unwrap(),
            "2026-01-15"
        );
    }
}
