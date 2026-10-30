import "./globals.css";

export const metadata = {
  title: "Jobs — Matt Myrtle",
  description: "Matt Myrtle's personal job pipeline.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
