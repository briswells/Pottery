import * as migration_20260615_014741_initial from './20260615_014741_initial';
import * as migration_20260615_031634_remove_category_add_number_of_classes from './20260615_031634_remove_category_add_number_of_classes';
import * as migration_20260615_150249_add_default_number_of_classes from './20260615_150249_add_default_number_of_classes';
import * as migration_20260615_153003_add_favicon_to_site_settings from './20260615_153003_add_favicon_to_site_settings';
import * as migration_20260615_194316_add_homepage_card_images from './20260615_194316_add_homepage_card_images';
import * as migration_20260616_222948_add_include_in_gallery from './20260616_222948_add_include_in_gallery';
import * as migration_20260616_224012_add_firing_completed_at from './20260616_224012_add_firing_completed_at';
import * as migration_20260618_190331_add_shelves from './20260618_190331_add_shelves';
import * as migration_20260619_192701_add_shelf_sort_key from './20260619_192701_add_shelf_sort_key';
import * as migration_20260707_184022_add_coupons from './20260707_184022_add_coupons';
import * as migration_20260708_214254_paid_firings from './20260708_214254_paid_firings';
import * as migration_20260709_152629_firing_dropped_off from './20260709_152629_firing_dropped_off';
import * as migration_20260715_221422_newsletters from './20260715_221422_newsletters';
import * as migration_20260730_004506_firings_page_image from './20260730_004506_firings_page_image';

export const migrations = [
  {
    up: migration_20260615_014741_initial.up,
    down: migration_20260615_014741_initial.down,
    name: '20260615_014741_initial',
  },
  {
    up: migration_20260615_031634_remove_category_add_number_of_classes.up,
    down: migration_20260615_031634_remove_category_add_number_of_classes.down,
    name: '20260615_031634_remove_category_add_number_of_classes',
  },
  {
    up: migration_20260615_150249_add_default_number_of_classes.up,
    down: migration_20260615_150249_add_default_number_of_classes.down,
    name: '20260615_150249_add_default_number_of_classes',
  },
  {
    up: migration_20260615_153003_add_favicon_to_site_settings.up,
    down: migration_20260615_153003_add_favicon_to_site_settings.down,
    name: '20260615_153003_add_favicon_to_site_settings',
  },
  {
    up: migration_20260615_194316_add_homepage_card_images.up,
    down: migration_20260615_194316_add_homepage_card_images.down,
    name: '20260615_194316_add_homepage_card_images',
  },
  {
    up: migration_20260616_222948_add_include_in_gallery.up,
    down: migration_20260616_222948_add_include_in_gallery.down,
    name: '20260616_222948_add_include_in_gallery',
  },
  {
    up: migration_20260616_224012_add_firing_completed_at.up,
    down: migration_20260616_224012_add_firing_completed_at.down,
    name: '20260616_224012_add_firing_completed_at',
  },
  {
    up: migration_20260618_190331_add_shelves.up,
    down: migration_20260618_190331_add_shelves.down,
    name: '20260618_190331_add_shelves',
  },
  {
    up: migration_20260619_192701_add_shelf_sort_key.up,
    down: migration_20260619_192701_add_shelf_sort_key.down,
    name: '20260619_192701_add_shelf_sort_key',
  },
  {
    up: migration_20260707_184022_add_coupons.up,
    down: migration_20260707_184022_add_coupons.down,
    name: '20260707_184022_add_coupons',
  },
  {
    up: migration_20260708_214254_paid_firings.up,
    down: migration_20260708_214254_paid_firings.down,
    name: '20260708_214254_paid_firings',
  },
  {
    up: migration_20260709_152629_firing_dropped_off.up,
    down: migration_20260709_152629_firing_dropped_off.down,
    name: '20260709_152629_firing_dropped_off',
  },
  {
    up: migration_20260715_221422_newsletters.up,
    down: migration_20260715_221422_newsletters.down,
    name: '20260715_221422_newsletters',
  },
  {
    up: migration_20260730_004506_firings_page_image.up,
    down: migration_20260730_004506_firings_page_image.down,
    name: '20260730_004506_firings_page_image'
  },
];
