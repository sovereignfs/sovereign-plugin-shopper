PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shopper_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`list_id` text NOT NULL,
	`product_id` text,
	`name` text NOT NULL,
	`quantity` text NOT NULL,
	`unit` text,
	`category` text,
	`icon` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`checked_at` integer,
	`added_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_shopper_list_items`("id", "tenant_id", "list_id", "product_id", "name", "quantity", "unit", "category", "icon", "sort_order", "checked_at", "added_by", "created_at", "updated_at") SELECT "id", "tenant_id", "list_id", "product_id", "name", "quantity", "unit", "category", "icon", "sort_order", "checked_at", "added_by", "created_at", "updated_at" FROM `shopper_list_items`;--> statement-breakpoint
DROP TABLE `shopper_list_items`;--> statement-breakpoint
ALTER TABLE `__new_shopper_list_items` RENAME TO `shopper_list_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_shopper_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`household_id` text,
	`list_id` text,
	`list_item_id` text,
	`product_id` text,
	`name` text NOT NULL,
	`quantity` text NOT NULL,
	`unit` text,
	`price` integer,
	`currency` text,
	`purchased_by` text,
	`purchased_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_shopper_purchases`("id", "tenant_id", "owner_user_id", "household_id", "list_id", "list_item_id", "product_id", "name", "quantity", "unit", "price", "currency", "purchased_by", "purchased_at") SELECT "id", "tenant_id", "owner_user_id", "household_id", "list_id", "list_item_id", "product_id", "name", "quantity", "unit", "price", "currency", "purchased_by", "purchased_at" FROM `shopper_purchases`;--> statement-breakpoint
DROP TABLE `shopper_purchases`;--> statement-breakpoint
ALTER TABLE `__new_shopper_purchases` RENAME TO `shopper_purchases`;