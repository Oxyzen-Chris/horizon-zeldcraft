const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..', '..');
const webRequire = createRequire(path.join(repoRoot, 'web', 'package.json'));
const ffmpegPath = webRequire('ffmpeg-static');

const marketingDir = __dirname;
const screenshotsDir = path.join(marketingDir, 'screenshots');
const buildDir = path.join(marketingDir, 'build-work');
const outputFile = path.join(marketingDir, 'teaser-fr.mp4');
const fontCandidates = [
  'C:\\Windows\\Fonts\\arialbd.ttf',
  'C:\\Windows\\Fonts\\Arialbd.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\Arial.ttf',
];

const segmentDuration = 4;
const frameRate = 30;
const segmentFrames = segmentDuration * frameRate;
const fontPath = fontCandidates.find((candidate) => fs.existsSync(candidate));

if (!fontPath) {
  throw new Error('No suitable Windows Arial font found for drawtext.');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  ensureDir(dirPath);
}

function toFfmpegPath(inputPath) {
  return inputPath.replace(/\\/g, '/').replace(':', '\\:');
}

function runFfmpeg(args, label) {
  const result = spawnSync(ffmpegPath, args, {
    cwd: marketingDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  return result;
}

function writeTextAsset(fileName, content) {
  const target = path.join(buildDir, fileName);
  fs.writeFileSync(target, content, 'utf8');
  return path.posix.join('build-work', fileName);
}

function makeOverlayFilters(textFile, position = 'bottom') {
  const font = toFfmpegPath(fontPath);
  if (position === 'center') {
    return [
      "drawbox=x=140:y=280:w=iw-280:h=520:color=0x1f1238@0.72:t=fill",
      "drawbox=x=170:y=310:w=iw-340:h=8:color=0xd4af37@0.95:t=fill",
      `drawtext=fontfile='${font}':textfile='${textFile}':fontcolor=white:fontsize=72:line_spacing=18:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.8:shadowx=3:shadowy=3`,
    ];
  }

  return [
    'drawbox=x=0:y=ih-230:w=iw:h=230:color=black@0.46:t=fill',
    `drawtext=fontfile='${font}':textfile='${textFile}':fontcolor=white:fontsize=54:line_spacing=12:x=(w-text_w)/2:y=h-150:shadowcolor=black@0.8:shadowx=2:shadowy=2`,
  ];
}

function buildStillSegment(inputFile, outputFileName, textFile) {
  const filters = [
    'scale=2200:1238:force_original_aspect_ratio=increase',
    `zoompan=z='min(zoom+0.0006,1.08)':x='iw/2-(iw/zoom/2)+on*0.40':y='ih/2-(ih/zoom/2)+on*0.15':d=${segmentFrames}:s=1920x1080:fps=${frameRate}`,
    'trim=duration=4',
    'setpts=PTS-STARTPTS',
  ];

  if (textFile) {
    filters.push(...makeOverlayFilters(textFile));
  }

  filters.push('format=yuv420p');

  runFfmpeg(
    [
      '-y',
      '-loop',
      '1',
      '-i',
      inputFile,
      '-t',
      String(segmentDuration),
      '-vf',
      filters.join(','),
      '-r',
      String(frameRate),
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      outputFileName,
    ],
    `segment ${outputFileName}`,
  );
}

function buildCardSegment(outputFileName, backgroundColor, textFile, position = 'center') {
  const filters = [
    ...makeOverlayFilters(textFile, position),
    'drawbox=x=0:y=0:w=iw:h=18:color=0xd4af37@0.95:t=fill',
    'drawbox=x=0:y=ih-18:w=iw:h=18:color=0x7c3aed@0.95:t=fill',
    'format=yuv420p',
  ];

  runFfmpeg(
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${backgroundColor}:s=1920x1080:d=${segmentDuration}`,
      '-vf',
      filters.join(','),
      '-r',
      String(frameRate),
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      outputFileName,
    ],
    `card ${outputFileName}`,
  );
}

function fileExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

function probeVideo(filePath) {
  const result = runFfmpeg(
    ['-v', 'info', '-i', filePath, '-f', 'null', '-'],
    'video verification',
  );

  const durationMatch = result.stderr.match(/Duration:\s+(\d{2}:\d{2}:\d{2}\.\d{2})/);
  return {
    duration: durationMatch ? durationMatch[1] : 'unknown',
    stderr: result.stderr,
  };
}

function main() {
  ensureDir(screenshotsDir);
  cleanDir(buildDir);

  const requiredScreens = [
    '01-welcome-screen-landscape.png',
    '02-language-switcher-en-landscape.png',
    '03-demo-access-modal-landscape.png',
    '04-play-without-wallet-modal-landscape.png',
    '05-administration-panel-landscape.png',
  ];

  for (const screen of requiredScreens) {
    const fullPath = path.join(screenshotsDir, screen);
    if (!fileExists(fullPath)) {
      throw new Error(`Missing screenshot: ${fullPath}`);
    }
  }

  const titleText = writeTextAsset('title.txt', 'Horizon ZeldCraft');
  const companionText = writeTextAsset('companion.txt', 'Un compagnon Web3 à faire grandir chaque jour');
  const sepoliaText = writeTextAsset('sepolia.txt', "Sépolia aujourd'hui. Ethereum demain.");
  const outroText = writeTextAsset('outro.txt', "Rejoins l'aventure — @horizon.zeldcraft");

  buildCardSegment(path.join(buildDir, '01-title-card.mp4'), '0x140b26', titleText, 'center');
  buildStillSegment(path.join(screenshotsDir, '01-welcome-screen-landscape.png'), path.join(buildDir, '02-welcome.mp4'), companionText);
  buildStillSegment(path.join(screenshotsDir, '02-language-switcher-en-landscape.png'), path.join(buildDir, '03-language.mp4'));
  buildStillSegment(path.join(screenshotsDir, '03-demo-access-modal-landscape.png'), path.join(buildDir, '04-demo.mp4'));
  buildStillSegment(path.join(screenshotsDir, '04-play-without-wallet-modal-landscape.png'), path.join(buildDir, '05-wallet-free.mp4'), sepoliaText);
  buildStillSegment(path.join(screenshotsDir, '05-administration-panel-landscape.png'), path.join(buildDir, '06-admin.mp4'));
  buildCardSegment(path.join(buildDir, '07-outro-card.mp4'), '0x12081d', outroText, 'center');

  const filterGraph = [
    '[0:v][1:v]xfade=transition=fade:duration=1:offset=3[v01]',
    '[v01][2:v]xfade=transition=fade:duration=1:offset=6[v02]',
    '[v02][3:v]xfade=transition=fade:duration=1:offset=9[v03]',
    '[v03][4:v]xfade=transition=fade:duration=1:offset=12[v04]',
    '[v04][5:v]xfade=transition=fade:duration=1:offset=15[v05]',
    '[v05][6:v]xfade=transition=fade:duration=1:offset=18[final]',
  ].join(';');

  runFfmpeg(
    [
      '-y',
      '-i',
      path.join(buildDir, '01-title-card.mp4'),
      '-i',
      path.join(buildDir, '02-welcome.mp4'),
      '-i',
      path.join(buildDir, '03-language.mp4'),
      '-i',
      path.join(buildDir, '04-demo.mp4'),
      '-i',
      path.join(buildDir, '05-wallet-free.mp4'),
      '-i',
      path.join(buildDir, '06-admin.mp4'),
      '-i',
      path.join(buildDir, '07-outro-card.mp4'),
      '-filter_complex',
      filterGraph,
      '-map',
      '[final]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputFile,
    ],
    'final teaser assembly',
  );

  if (!fileExists(outputFile)) {
    throw new Error(`Teaser output missing or empty: ${outputFile}`);
  }

  const stats = fs.statSync(outputFile);
  const verification = probeVideo(outputFile);

  console.log(`Created ${outputFile}`);
  console.log(`Size bytes: ${stats.size}`);
  console.log(`Duration: ${verification.duration}`);

  fs.rmSync(buildDir, { recursive: true, force: true });
}

main();
