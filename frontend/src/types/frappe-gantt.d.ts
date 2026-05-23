declare module 'frappe-gantt' {
  export interface FrappeGanttTask {
    id: string;
    name: string;
    start: string;
    end: string;
    progress?: number;
    dependencies?: string[];
    custom_class?: string;
    [key: string]: unknown;
  }

  export interface FrappeGanttOptions {
    view_mode?: 'Day' | 'Week' | 'Month' | 'Year' | string;
    readonly?: boolean;
    readonly_dates?: boolean;
    readonly_progress?: boolean;
    popup_on?: 'click' | 'hover';
    popup?: false | ((context: { task: FrappeGanttTask }) => string | false | void);
    container_height?: number | 'auto';
    bar_height?: number;
    padding?: number;
    auto_move_label?: boolean;
    today_button?: boolean;
    view_mode_select?: boolean;
    lines?: 'none' | 'vertical' | 'horizontal' | 'both';
    language?: string;
    on_click?: (task: FrappeGanttTask) => void;
    on_double_click?: (task: FrappeGanttTask) => void;
  }

  export default class Gantt {
    constructor(wrapper: string | HTMLElement | SVGElement, tasks: FrappeGanttTask[], options?: FrappeGanttOptions);
    refresh(tasks: FrappeGanttTask[]): void;
    change_view_mode(mode?: string, maintain_pos?: boolean): void;
    update_options(options: Partial<FrappeGanttOptions>): void;
  }
}
