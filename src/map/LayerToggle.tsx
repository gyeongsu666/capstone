import { Button } from 'antd';
import { CheckOutlined } from '@ant-design/icons';

export interface LayerOption<K extends string> {
  key: K;
  label: string;
}

interface LayerToggleProps<K extends string> {
  options: LayerOption<K>[];
  value: Record<K, boolean>;
  onToggle: (key: K) => void;
}

/** 레이어 토글: 지도 왼쪽 위 */
export function LayerToggle<K extends string>({ options, value, onToggle }: LayerToggleProps<K>) {
  return (
    <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="지도 레이어">
      {options.map((o) => {
        const on = value[o.key];
        return (
          <Button
            key={o.key}
            size="small"
            type={on ? 'primary' : 'default'}
            icon={on ? <CheckOutlined /> : undefined}
            aria-pressed={on}
            onClick={() => onToggle(o.key)}
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}
