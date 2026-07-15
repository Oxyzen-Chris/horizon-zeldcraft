/**
 * Horizon ZeldCraft — Mobile (Expo Go)
 *
 * Vue simplifiée du Voxlyn pour mobile. Se connecte au même smart contract
 * que la version web. Pour la connexion wallet en mobile, on utilise
 * WalletConnect via wagmi (à intégrer en Phase 2 avec RN adapter).
 *
 * En Phase 1 : affichage des skins + lien vers l'app web pour interagir.
 */
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ScrollView, Linking, TouchableOpacity } from 'react-native';
import Svg, { Circle, Ellipse, Path, RadialGradient, Stop, Defs } from 'react-native-svg';
import { useState } from 'react';

const LOCALES = {
  fr: { title: 'Horizon ZeldCraft', sub: 'Ton Voxlyn t\'attend', open: 'Ouvrir l\'app web' },
  en: { title: 'Horizon ZeldCraft', sub: 'Your Voxlyn awaits',  open: 'Open web app' },
  es: { title: 'Horizon ZeldCraft', sub: 'Tu Voxlyn te espera', open: 'Abrir app web' },
  pt: { title: 'Horizon ZeldCraft', sub: 'Seu Voxlyn espera',   open: 'Abrir app web' },
} as const;

type Locale = keyof typeof LOCALES;
const STAGES = ['Œuf', 'Éclos', 'Juvénile', 'Adulte', 'Ancien'];

export default function App() {
  const [locale, setLocale] = useState<Locale>('fr');
  const [stage, setStage] = useState(3);
  const L = LOCALES[locale];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.langRow}>
          {(Object.keys(LOCALES) as Locale[]).map((l) => (
            <TouchableOpacity key={l} onPress={() => setLocale(l)}
              style={[styles.langBtn, locale === l && styles.langBtnActive]}>
              <Text style={styles.langTxt}>{l.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.title}>🐉 {L.title}</Text>
        <Text style={styles.sub}>{L.sub}</Text>

        <View style={styles.skinBox}>
          <VoxlynSkin stage={stage} />
          <Text style={styles.stageTxt}>{STAGES[stage]}</Text>
        </View>

        <View style={styles.stageRow}>
          {STAGES.map((s, i) => (
            <TouchableOpacity key={i} onPress={() => setStage(i)}
              style={[styles.stageBtn, stage === i && styles.stageBtnActive]}>
              <Text style={styles.stageBtnTxt}>{i}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.cta}
          onPress={() => Linking.openURL('https://horizon-zeldcraft.vercel.app')}>
          <Text style={styles.ctaTxt}>{L.open} →</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Phase 1 — Wallet connect natif en Phase 2</Text>
      </ScrollView>
      <StatusBar style="light" />
    </View>
  );
}

function VoxlynSkin({ stage }: { stage: number }) {
  const palettes = [
    { bg: '#7dd3fc', accent: '#0ea5e9' },
    { bg: '#a5f3fc', accent: '#06b6d4' },
    { bg: '#67e8f9', accent: '#0891b2' },
    { bg: '#f472b6', accent: '#db2777' },
    { bg: '#fbbf24', accent: '#d97706' },
  ];
  const p = palettes[stage];
  return (
    <Svg width={220} height={220} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="g" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={p.bg} stopOpacity="0.5" />
          <Stop offset="100%" stopColor={p.bg} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="45" fill="url(#g)" />
      {stage === 0 && <Ellipse cx="50" cy="55" rx="22" ry="28" fill={p.bg} stroke={p.accent} strokeWidth="2" />}
      {stage >= 1 && (
        <>
          <Path d={stage >= 3
            ? "M20 55 Q30 25 50 25 Q70 25 80 55 L72 80 L28 80 Z"
            : "M25 55 Q35 30 50 30 Q65 30 75 55 L70 75 L30 75 Z"}
            fill={p.bg} stroke={p.accent} strokeWidth="2" />
          <Circle cx="42" cy="50" r="3.5" fill="#0f172a" />
          <Circle cx="58" cy="50" r="3.5" fill="#0f172a" />
          <Path d="M40 65 Q50 70 60 65" stroke="#0f172a" strokeWidth="1.5" fill="none" />
        </>
      )}
      {stage >= 2 && (
        <>
          <Path d="M20 55 L10 45 L15 60 Z" fill={p.accent} />
          <Path d="M80 55 L90 45 L85 60 Z" fill={p.accent} />
        </>
      )}
      {stage === 4 && <Path d="M40 20 L45 8 L50 15 L55 8 L60 20" stroke={p.accent} strokeWidth="2.5" fill="none" />}
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  container: { padding: 20, alignItems: 'center' },
  langRow: { flexDirection: 'row', gap: 8, marginTop: 40, marginBottom: 20 },
  langBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1e293b' },
  langBtnActive: { backgroundColor: '#7dd3fc' },
  langTxt: { color: '#e2e8f0', fontWeight: 'bold', fontSize: 12 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#7dd3fc', marginBottom: 4 },
  sub: { fontSize: 14, color: '#94a3b8', marginBottom: 30 },
  skinBox: { alignItems: 'center', marginBottom: 20 },
  stageTxt: { color: '#e2e8f0', fontSize: 18, fontWeight: '600', marginTop: 8 },
  stageRow: { flexDirection: 'row', gap: 8, marginBottom: 30 },
  stageBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' },
  stageBtnActive: { backgroundColor: '#f472b6' },
  stageBtnTxt: { color: '#fff', fontWeight: 'bold' },
  cta: { backgroundColor: '#7dd3fc', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  ctaTxt: { color: '#0f172a', fontWeight: 'bold', fontSize: 16 },
  footer: { color: '#64748b', fontSize: 11, marginTop: 30, textAlign: 'center' },
});
