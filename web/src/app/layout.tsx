import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'Horizon ZeldCraft — Voxlyn',
  description: 'Feed your Voxlyn on-chain. Web3 Tamagotchi inspired by Zelda × Minecraft × WoW.',
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
