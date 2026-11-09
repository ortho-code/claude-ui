import { ICONS, type IconName } from '../../shared/helpers/icons';
import { strokeIcon } from '../ui/svg';

/** An icon as SVG markup, at `size` px, through the one helper every stroked icon in the app is drawn with. */
export const iconSvg = (name: IconName, size = 14): string => strokeIcon(size, ICONS[name]);
