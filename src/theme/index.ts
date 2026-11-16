import type { ThemeConfig } from 'antd';
import { layoutColor, PRIMARY, statusColor } from '@/theme/colors';

export * from '@/theme/colors';

export const FONT_FAMILY =
  "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";

/** 레이아웃 치수 (docs/design.md "전체 레이아웃") */
export const SIDER_WIDTH = 220;
export const SIDER_COLLAPSED_WIDTH = 64;
export const PANEL_WIDTH = 360;
/** 이보다 좁으면 사이드바를 아이콘만 보이게 접는다 */
export const COLLAPSE_BREAKPOINT = 1280;

export const theme: ThemeConfig = {
  token: {
    colorPrimary: PRIMARY,
    colorSuccess: statusColor.confirmed,
    colorWarning: statusColor.pending,
    colorError: statusColor.danger,
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    // 12px 미만 금지: Antd의 작은 글자(fontSizeSM)도 12px
    fontSizeSM: 12,
    colorBgLayout: layoutColor.pageBg,
    borderRadius: 6,
  },
  components: {
    Layout: {
      siderBg: layoutColor.siderBg,
      headerBg: '#ffffff',
      bodyBg: layoutColor.pageBg,
    },
    Menu: {
      darkItemBg: layoutColor.siderBg,
      darkSubMenuItemBg: layoutColor.siderBg,
      darkItemColor: layoutColor.siderText,
      darkItemHoverBg: layoutColor.siderItemHoverBg,
      darkItemSelectedBg: layoutColor.siderItemSelectedBg,
      darkItemSelectedColor: '#ffffff',
      darkGroupTitleColor: layoutColor.siderTextMuted,
      groupTitleFontSize: 12,
      itemBorderRadius: 0,
      itemMarginInline: 0,
      itemHeight: 40,
    },
    Typography: {
      titleMarginBottom: 0,
      titleMarginTop: 0,
    },
  },
};
