import { GearSix } from '@phosphor-icons/react';
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: P): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...rest,
  };
}

export const LogoMark = (p: P) => (
  // 移植自上游 src/ui.tsx 的 BrandMark(圆环 + 轨道圆点,悬停旋转),填充色用工作台主题变量
  <svg {...base({ size: 28, ...p })} viewBox="0 0 24 24" focusable="false">
    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <g className="logo-orbit">
      <circle cx="17.15" cy="6.85" r="2.15" fill="var(--acc)" stroke="none" />
    </g>
  </svg>
);

export const IconHome = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 11.2 12 4.4l8 6.8V19a1 1 0 0 1-1 1h-4.6v-5.2h-4.8V20H5a1 1 0 0 1-1-1Z" />
  </svg>
);

export const IconDocs = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 3.5h6.5L19 9v10.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
    <path d="M13.5 3.5V9H19" />
    <path d="M9.5 13h5.5M9.5 16.5h5.5" />
  </svg>
);

export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M19.5 14.2A7.6 7.6 0 0 1 9.8 4.5a7.6 7.6 0 1 0 9.7 9.7Z" />
  </svg>
);

export const IconCalendar = (p: P) => (
  <svg {...base({ size: 16, ...p })}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </svg>
);

export const IconCheckSquare = (p: P) => (
  <svg {...base({ size: 16, ...p })}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="m8.5 12.2 2.4 2.4 4.8-5" />
  </svg>
);

export const IconChevronDown = (p: P) => (
  <svg {...base({ size: 13, strokeWidth: 2, ...p })}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconVideo = (p: P) => (
  <svg {...base({ size: 18, ...p })}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="m10 9.5 4.5 2.5L10 14.5Z" />
  </svg>
);

export const IconWeb = (p: P) => (
  <svg {...base({ size: 18, ...p })}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9h17M7 6.8h.01M9.6 6.8h.01" />
  </svg>
);

export const IconShieldCheck = (p: P) => (
  <svg {...base({ size: 18, ...p })}>
    <path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6Z" />
    <path d="m9 11.8 2.2 2.2 4-4.2" />
  </svg>
);

export const IconPackage = (p: P) => (
  <svg {...base({ size: 18, ...p })}>
    <path d="M12 3.5 3.5 8v8l8.5 4.5L20.5 16V8Z" />
    <path d="M3.5 8l8.5 4.5L20.5 8M12 12.5v8" />
  </svg>
);

export const IconClipboardText = (p: P) => (
  <svg {...base({ size: 18, ...p })}>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 4.5V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5M9 10h6M9 14h4" />
  </svg>
);

export const IconBug = (p: P) => (
  <svg {...base({ size: 18, ...p })}>
    <rect x="7" y="7" width="10" height="10" rx="5" />
    <path d="M12 3v4M5 12H3m18 0h-2M7 7l-2-2m14 2 2-2M7 17l-2 2m14-2 2 2M12 10v4" />
  </svg>
);

export const IconDownload = (p: P) => (
  <svg {...base({ size: 15, strokeWidth: 1.8, ...p })}>
    <path d="M12 15V4M7.5 8 12 3.5 16.5 8" />
    <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const IconZoomOut = (p: P) => (
  <svg {...base({ size: 13, strokeWidth: 2, ...p })}>
    <path d="M5 12h14" />
  </svg>
);

export const IconZoomIn = (p: P) => (
  <svg {...base({ size: 13, strokeWidth: 2, ...p })}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

// 设置工作台图标:用户已定 Phosphor GearSix(自绘齿轮「太像太阳」被否),WB_ICONS 渲染无 props,包一层固定尺寸
const GearRail = () => <GearSix size={20} />;

/** 一级工作台图标(图标栏与首页「更多工作台」共用,保证两处对齐) */
export const WB_ICONS = {
  home: IconHome,
  media: IconVideo,
  web: IconWeb,
  permission: IconShieldCheck,
  delivery: IconPackage,
  pbi: IconClipboardText,
  dts: IconBug,
  life: IconMoon,
  settings: GearRail,
} as const;
