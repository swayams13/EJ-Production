import { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-base">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`even:bg-paper ${className}`}>{children}</tr>;
}

export function Th({
  children,
  className = "",
  numeric = false,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { className?: string; numeric?: boolean }) {
  return (
    <th
      className={`border-b-[1.5px] border-ink-soft px-2.5 py-2.5 font-data text-xs font-medium uppercase tracking-wide text-ink-soft ${
        numeric ? "text-center" : "text-left"
      } ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "", numeric = false, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { className?: string; numeric?: boolean }) {
  return (
    <td
      className={`border-b border-line px-2.5 py-2.5 ${numeric ? "font-data tabular-nums text-center" : ""} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}
