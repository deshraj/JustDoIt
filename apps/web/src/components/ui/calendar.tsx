'use client';

import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { cn } from '@/lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Thin wrapper over react-day-picker v9, themed via its CSS custom
 * properties (see the `.rdp-root` override in globals.css) rather than
 * fighting its v9 classNames API.
 */
function Calendar({ className, ...props }: CalendarProps) {
  return <DayPicker className={cn('p-2', className)} {...props} />;
}

export { Calendar };
