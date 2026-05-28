// @Service 节假日判定：补班日优先 → 假期段 → 周末兜底
// JS 端 getDayType() 保持独立实现，修改需同步两端

use chrono::Datelike;
use crate::app_config::HolidayYearConfig;

pub fn get_day_type(date: &chrono::NaiveDate, holiday: Option<&HolidayYearConfig>) -> &'static str {
    let mmdd = format!("{:02}{:02}", date.month(), date.day());
    let weekday = date.weekday().num_days_from_monday(); // 0=Mon..6=Sun

    if let Some(h) = holiday {
        // 补班日（周末上班）→ 工作日
        if h.makeup_days.contains(&mmdd) {
            return "workday";
        }
        // 在假期段内 → 休息日（跨年段如 1228-0102 也算在内）
        if h.holidays.iter().any(|p| {
            if p.start.as_str() <= p.end.as_str() {
                mmdd >= p.start && mmdd <= p.end
            } else {
                mmdd >= p.start || mmdd <= p.end
            }
        }) {
            return "restday";
        }
    }

    // 周末且非补班 → 休息日
    if weekday >= 5 { // 周六=5, 周日=6
        return "restday";
    }

    "workday"
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;
    use crate::app_config::{HolidayYearConfig, HolidayPeriod};

    fn holiday_2026() -> HolidayYearConfig {
        HolidayYearConfig {
            year: 2026,
            holidays: vec![HolidayPeriod {
                name: "春节".to_string(),
                start: "0128".to_string(),
                end: "0203".to_string(),
            }],
            makeup_days: vec!["0125".to_string(), "0211".to_string()],
        }
    }

    fn cross_year_holiday() -> HolidayYearConfig {
        HolidayYearConfig {
            year: 2026,
            holidays: vec![HolidayPeriod {
                name: "元旦".to_string(),
                start: "1228".to_string(),
                end: "0102".to_string(),
            }],
            makeup_days: vec![],
        }
    }

    #[test]
    fn weekday_is_workday() {
        let d = chrono::NaiveDate::from_ymd_opt(2026, 5, 4).unwrap();
        assert_eq!(get_day_type(&d, None), "workday");
    }

    #[test]
    fn weekend_is_restday() {
        let d = chrono::NaiveDate::from_ymd_opt(2026, 5, 9).unwrap();
        assert_eq!(get_day_type(&d, None), "restday");
    }

    #[test]
    fn holiday_period_is_restday() {
        let h = holiday_2026();
        let d = chrono::NaiveDate::from_ymd_opt(2026, 2, 1).unwrap();
        assert_eq!(get_day_type(&d, Some(&h)), "restday");
    }

    #[test]
    fn makeup_day_is_workday() {
        let h = holiday_2026();
        let d = chrono::NaiveDate::from_ymd_opt(2026, 1, 25).unwrap();
        assert_eq!(get_day_type(&d, Some(&h)), "workday");
    }

    #[test]
    fn weekend_without_holiday_config_still_restday() {
        let d = chrono::NaiveDate::from_ymd_opt(2026, 1, 25).unwrap();
        assert_eq!(get_day_type(&d, None), "restday");
    }

    #[test]
    fn cross_year_holiday_jan1_is_restday() {
        let h = cross_year_holiday();
        let d = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        assert_eq!(get_day_type(&d, Some(&h)), "restday");
    }

    #[test]
    fn cross_year_holiday_dec30_is_restday() {
        let h = cross_year_holiday();
        let d = chrono::NaiveDate::from_ymd_opt(2025, 12, 30).unwrap();
        assert_eq!(get_day_type(&d, Some(&h)), "restday");
    }

    #[test]
    fn outside_cross_year_is_workday() {
        let h = cross_year_holiday();
        let d = chrono::NaiveDate::from_ymd_opt(2026, 1, 15).unwrap();
        assert_eq!(get_day_type(&d, Some(&h)), "workday");
    }

    #[test]
    fn makeup_overrides_holiday() {
        let h = HolidayYearConfig {
            year: 2026,
            holidays: vec![HolidayPeriod {
                name: "测试假期".to_string(),
                start: "0115".to_string(),
                end: "0120".to_string(),
            }],
            makeup_days: vec!["0117".to_string()],
        };
        let d = chrono::NaiveDate::from_ymd_opt(2026, 1, 17).unwrap();
        assert_eq!(get_day_type(&d, Some(&h)), "workday");
    }
}
