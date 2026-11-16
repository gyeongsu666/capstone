import { Result } from 'antd';

/** 아직 만들지 않은 화면 자리. 해당 단계에서 지운다. */
export function Placeholder({ step, what }: { step: number; what: string }) {
  return (
    <Result
      status="info"
      title={what}
      subTitle={`${step}단계에서 만들 화면이에요.`}
      style={{ margin: 'auto' }}
    />
  );
}
