import { Icons } from "@/components/icons";

type CalendarNavToolbarProps = {
  calendarMonth: { year: number; month: number };
  monthPickerOpen: boolean;
  setMonthPickerOpen: (open: boolean | ((value: boolean) => boolean)) => void;
  onGoToday: () => void;
  onSelectMonth: (month: number) => void;
  onChangeYear: (delta: number) => void;
  onJumpBackTwoMonths?: () => void;
};

export function CalendarNavToolbar({
  calendarMonth,
  monthPickerOpen,
  setMonthPickerOpen,
  onGoToday,
  onSelectMonth,
  onChangeYear,
  onJumpBackTwoMonths,
}: CalendarNavToolbarProps) {
  return (
    <div className="calendar-toolbar">
      <button type="button" className="btn calendar-toolbar-btn" onClick={onGoToday}>
        本日
      </button>
      <div className="calendar-month-picker">
        <button
          type="button"
          className="btn calendar-toolbar-btn calendar-month-trigger"
          onClick={() => setMonthPickerOpen((open) => !open)}
        >
          <Icons.Calendar size={16} className="btn-icon" />
          {calendarMonth.year}年{calendarMonth.month + 1}月
        </button>
        {monthPickerOpen ? (
          <div className="calendar-month-menu">
            <div className="calendar-year-row">
              <button type="button" className="calendar-year-btn" onClick={() => onChangeYear(-1)} aria-label="前年">
                <Icons.ChevronLeft size={16} />
              </button>
              <span className="calendar-year-label">{calendarMonth.year}年</span>
              <button type="button" className="calendar-year-btn" onClick={() => onChangeYear(1)} aria-label="翌年">
                <Icons.ChevronRight size={16} />
              </button>
            </div>
            <div className="calendar-month-grid">
              {Array.from({ length: 12 }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  className={`calendar-month-option${calendarMonth.month === index ? " active" : ""}`}
                  onClick={() => onSelectMonth(index)}
                >
                  {index + 1}月
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {onJumpBackTwoMonths ? (
        <button
          type="button"
          className="calendar-triangle-icon"
          onClick={onJumpBackTwoMonths}
          aria-label="過去2か月分を追加"
          title="過去2か月分を追加"
        >
          <Icons.ChevronUp size={16} />
        </button>
      ) : null}
    </div>
  );
}
