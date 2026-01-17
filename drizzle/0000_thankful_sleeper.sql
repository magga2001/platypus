CREATE TABLE "user_fills" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user" text NOT NULL,
	"coin" text NOT NULL,
	"oid" bigint NOT NULL,
	"tid" bigint NOT NULL,
	"px" text NOT NULL,
	"sz" text NOT NULL,
	"side" text NOT NULL,
	"time" bigint NOT NULL,
	"start_position" text,
	"dir" text,
	"closed_pnl" text,
	"crossed" boolean,
	"fee" text NOT NULL,
	"fee_token" text,
	"builder_fee" text,
	"hash" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_tid_idx" UNIQUE("user","tid")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_idx" ON "user_fills" USING btree ("user");--> statement-breakpoint
CREATE UNIQUE INDEX "time_idx" ON "user_fills" USING btree ("time");--> statement-breakpoint
CREATE UNIQUE INDEX "user_time_idx" ON "user_fills" USING btree ("user","time");--> statement-breakpoint
CREATE UNIQUE INDEX "user_coin_idx" ON "user_fills" USING btree ("user","coin");--> statement-breakpoint
CREATE UNIQUE INDEX "hash_idx" ON "user_fills" USING btree ("hash");