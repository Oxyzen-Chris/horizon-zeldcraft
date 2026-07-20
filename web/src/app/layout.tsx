import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'Horizon ZeldCraft — Synk',
  description: 'Follow Synk on-chain. Web3 Tamagotchi-style adventure inspired by Zelda × Minecraft × WoW.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
