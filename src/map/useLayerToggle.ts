import { useState } from 'react';

/** 레이어 켜고 끄기 상태. 위험 지역은 기본으로 켜 둔다(화면에서 defaults로 지정). */
export function useLayerToggle<K extends string>(defaults: Record<K, boolean>) {
  const [layers, setLayers] = useState(defaults);
  const toggle = (key: K) => setLayers((s) => ({ ...s, [key]: !s[key] }));
  return { layers, toggle };
}
