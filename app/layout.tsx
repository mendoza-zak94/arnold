import type { ReactNode } from 'react';

export const metadata = {
  title: 'Chad',
  description: 'A Telegram bot that tracks food, body, training and habits by chatting with it.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fff' }}>{children}</body>
    </html>
  );
}
