import fs from 'node:fs';

const p = 'src/components/MeetingScreen.tsx';
let t = fs.readFileSync(p, 'utf8');

t = t.replace(
  /import \{[\s\S]*?\} from '\.\.\/lib\/record';/,
  `import {
  createRecorder,
  downloadRecordZip,
  recordFiles,
  type RecordCast,
  type RecordFile,
} from '../lib/record';`,
);

t = t.replace(
  /import \{[\s\S]*?\} from '\.\.\/lib\/meetingIntel';/,
  `import { type AirtimeMap } from '../lib/meetingIntel';`,
);

if (!t.includes("RecordingsDialog")) {
  t = t.replace(
    "import { SettingsDialog } from './SettingsDialog';",
    "import { SettingsDialog } from './SettingsDialog';\nimport { RecordingsDialog } from './RecordingsDialog';",
  );
}

t = t.replace(/\n  function openReceiptThenLeave\(\) \{[\s\S]*?\}\n/, '\n');

if (!t.includes("dialog === 'recordings'")) {
  t = t.replace(
    "{dialog === 'facecast' && canRecord && (",
    `{dialog === 'recordings' && recordReady && (
        <RecordingsDialog files={recordReady} onClose={() => setDialog(null)} />
      )}
      {dialog === 'facecast' && canRecord && (`,
  );
}

// Remove unused unique-feature state for now (keep recording).
t = t.replace(
  /  const \[airtime, setAirtime\] = useState<AirtimeMap>\(\{\}\);\n  const \[sameRoom, setSameRoom\] = useState<string\[\]>\(\[\]\);\n  const \[joinedAt\] = useState\(\(\) => Date\.now\(\)\);\n/,
  '',
);
t = t.replace(/  const airtimeRef = useRef<AirtimeMap>\(\{\}\);\n/, '');
t = t.replace(/import \{ type AirtimeMap \} from '\.\.\/lib\/meetingIntel';\n/, '');

fs.writeFileSync(p, t);
console.log('patched meeting screen');
