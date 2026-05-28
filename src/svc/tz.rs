use chrono::Datelike;

// @Service 时区工具：解析时区名称 + DST 日期计算
// 替代 chrono-tz 依赖节省 2-3MB，手动维护 7 个常用时区的 DST 规则

// @Service 解析时区名称为固定偏移（含 DST 自动切换）
pub fn resolve_timezone(tz_name: &str) -> Option<chrono::FixedOffset> {
    use chrono::FixedOffset;
    match tz_name {
        "Asia/Shanghai"     => Some(FixedOffset::east_opt(8 * 3600)?),
        "Asia/Kolkata"      => Some(FixedOffset::east_opt(5 * 3600 + 1800)?),
        "Asia/Tokyo"        => Some(FixedOffset::east_opt(9 * 3600)?),
        "UTC"               => Some(FixedOffset::east_opt(0)?),
        "Europe/London"     => {
            let now = chrono::Utc::now().naive_utc().date();
            let year = now.year();
            let bst_start = last_sunday_of_month(year, 3);
            let bst_end = last_sunday_of_month(year, 10);
            let offset = if now >= bst_start && now < bst_end { 1 } else { 0 };
            Some(FixedOffset::east_opt(offset * 3600)?)
        }
        "America/New_York"  => {
            let now = chrono::Utc::now().naive_utc().date();
            let year = now.year();
            let edt_start = nth_sunday_of_month(year, 3, 2);
            let edt_end = nth_sunday_of_month(year, 11, 1);
            let offset = if now >= edt_start && now < edt_end { -4 } else { -5 };
            Some(FixedOffset::east_opt(offset * 3600)?)
        }
        "Australia/Sydney"  => {
            let now = chrono::Utc::now().naive_utc().date();
            let year = now.year();
            let aedt_start = nth_sunday_of_month(year, 10, 1);
            let aedt_end = nth_sunday_of_month(year + 1, 4, 1);
            let offset = if now >= aedt_start && now < aedt_end { 11 } else { 10 };
            Some(FixedOffset::east_opt(offset * 3600)?)
        }
        _ => None,
    }
}

// @Utils 计算某月第 N 个星期日（DST 切换日期计算用）
pub fn nth_sunday_of_month(year: i32, month: u32, n: u32) -> chrono::NaiveDate {
    let first = chrono::NaiveDate::from_ymd_opt(year, month, 1).expect("valid date");
    let first_dow = first.weekday().num_days_from_sunday();
    let day = 1 + if first_dow == 0 { 0 } else { 7 - first_dow } + (n - 1) * 7;
    chrono::NaiveDate::from_ymd_opt(year, month, day).expect("valid date")
}

// @Utils 计算某月最后一个星期日（英国 DST 切换用）
pub fn last_sunday_of_month(year: i32, month: u32) -> chrono::NaiveDate {
    let (next_y, next_m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    let last_day = chrono::NaiveDate::from_ymd_opt(next_y, next_m, 1).expect("valid date").pred_opt().expect("non-min date");
    let dow = last_day.weekday().num_days_from_sunday();
    last_day.checked_sub_days(chrono::Days::new(dow as u64)).expect("valid date")
}

// @Utils 计算某月的最后一天（月末模式提醒用）
pub fn last_day_of_month(year: i32, month: u32) -> chrono::NaiveDate {
    let (next_y, next_m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    chrono::NaiveDate::from_ymd_opt(next_y, next_m, 1).expect("valid date").pred_opt().expect("non-min date")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_sunday_of_march_2026() {
        assert_eq!(
            nth_sunday_of_month(2026, 3, 1),
            chrono::NaiveDate::from_ymd_opt(2026, 3, 1).unwrap()
        );
    }

    #[test]
    fn second_sunday_of_march_2026() {
        assert_eq!(
            nth_sunday_of_month(2026, 3, 2),
            chrono::NaiveDate::from_ymd_opt(2026, 3, 8).unwrap()
        );
    }

    #[test]
    fn first_sunday_of_january_2027() {
        assert_eq!(
            nth_sunday_of_month(2027, 1, 1),
            chrono::NaiveDate::from_ymd_opt(2027, 1, 3).unwrap()
        );
    }

    #[test]
    fn second_sunday_of_november_2026() {
        let first = nth_sunday_of_month(2026, 11, 1);
        assert_eq!(first, chrono::NaiveDate::from_ymd_opt(2026, 11, 1).unwrap());
        let second = nth_sunday_of_month(2026, 11, 2);
        assert_eq!(second, chrono::NaiveDate::from_ymd_opt(2026, 11, 8).unwrap());
    }

    #[test]
    fn last_sunday_of_march_2026() {
        assert_eq!(
            last_sunday_of_month(2026, 3),
            chrono::NaiveDate::from_ymd_opt(2026, 3, 29).unwrap()
        );
    }

    #[test]
    fn last_sunday_of_october_2026() {
        assert_eq!(
            last_sunday_of_month(2026, 10),
            chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap()
        );
    }

    #[test]
    fn last_sunday_of_december() {
        assert_eq!(
            last_sunday_of_month(2026, 12),
            chrono::NaiveDate::from_ymd_opt(2026, 12, 27).unwrap()
        );
    }

    #[test]
    fn last_day_of_feb_2026() {
        assert_eq!(
            last_day_of_month(2026, 2),
            chrono::NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()
        );
    }

    #[test]
    fn last_day_of_feb_2028() {
        assert_eq!(
            last_day_of_month(2028, 2),
            chrono::NaiveDate::from_ymd_opt(2028, 2, 29).unwrap()
        );
    }

    #[test]
    fn last_day_of_january() {
        assert_eq!(
            last_day_of_month(2026, 1),
            chrono::NaiveDate::from_ymd_opt(2026, 1, 31).unwrap()
        );
    }

    #[test]
    fn last_day_of_december() {
        assert_eq!(
            last_day_of_month(2026, 12),
            chrono::NaiveDate::from_ymd_opt(2026, 12, 31).unwrap()
        );
    }

    #[test]
    fn tz_shanghai() {
        let tz = resolve_timezone("Asia/Shanghai");
        assert!(tz.is_some());
        assert_eq!(tz.unwrap().local_minus_utc(), 8 * 3600);
    }

    #[test]
    fn tz_kolkata() {
        let tz = resolve_timezone("Asia/Kolkata");
        assert!(tz.is_some());
        assert_eq!(tz.unwrap().local_minus_utc(), 5 * 3600 + 1800);
    }

    #[test]
    fn tz_tokyo() {
        let tz = resolve_timezone("Asia/Tokyo");
        assert!(tz.is_some());
        assert_eq!(tz.unwrap().local_minus_utc(), 9 * 3600);
    }

    #[test]
    fn tz_utc() {
        let tz = resolve_timezone("UTC");
        assert!(tz.is_some());
        assert_eq!(tz.unwrap().local_minus_utc(), 0);
    }

    #[test]
    fn tz_invalid() {
        assert!(resolve_timezone("Mars/Olympus").is_none());
    }
}
