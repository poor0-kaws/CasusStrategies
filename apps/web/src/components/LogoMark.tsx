// This file renders the opposing CS curves used as the Casus Strategies brand mark.

interface LogoMarkProps {
  title?: string;
}

export function LogoMark({ title }: LogoMarkProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className="logo-mark"
      role={title ? "img" : undefined}
      viewBox="0 0 48 48"
    >
      {title ? <title>{title}</title> : null}
      <path d="M34.5 9.5C28.7 5.8 18.3 6.2 12.5 12.8C5.8 20.3 8.2 32 16.2 37.1C20.4 39.8 25.8 40.4 30.3 38.8" />
      <path d="M17.5 13.2C22.8 8.7 32.6 8.1 37.4 13.2C42.5 18.6 38.8 24.1 31.2 25.2C23.5 26.4 19.5 30.1 21.1 34.5C23.2 40.2 33.3 41.6 39.3 36.4" />
      <circle cx="12.5" cy="12.8" r="2" />
      <circle cx="39.3" cy="36.4" r="2" />
    </svg>
  );
}
