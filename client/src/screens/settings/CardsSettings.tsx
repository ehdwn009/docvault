import type { UserSettings } from '../../lib/api';
import { rowId } from './catalog';
import SettingRow, { Switch } from './SettingRow';

type Props = { settings: UserSettings; onChange: (patch: Partial<UserSettings>) => void };

// SCR-401: 배움 카드 취향 — 문서 속 용어 밑줄(활용 ②)·질문 때 카드 문맥(활용 ④)
export default function CardsSettings({ settings, onChange }: Props) {
  return (
    <>
      <SettingRow id={rowId('cards', 'termHighlight')} title="문서 속 내 카드 용어에 점선 밑줄" desc="누르면 한 줄 정의가 뜨고 카드로 갈 수 있습니다. 읽기에 방해되면 끄세요">
        <Switch checked={settings.termHighlight === 1} onChange={(v) => onChange({ termHighlight: v ? 1 : 0 })} label="문서 속 내 카드 용어에 점선 밑줄" />
      </SettingRow>
      <SettingRow id={rowId('cards', 'askWithCards')} title="질문할 때 관련 카드 함께 보내기" desc="질문에 내 카드의 이름이 나오면 그 카드(최대 3장)를 AI가 먼저 읽고 이어서 답합니다. 무엇을 보내는지 입력창 위에 보입니다">
        <Switch checked={settings.askWithCards === 1} onChange={(v) => onChange({ askWithCards: v ? 1 : 0 })} label="질문할 때 관련 카드 함께 보내기" />
      </SettingRow>
    </>
  );
}
