-- 0048 — add the rest of Ethiopia's common payment rails
--
-- The enum started with Telebirr + CBE; migration ("ABYSSINIA/AWASH/DASHEN") added
-- three banks. This adds the remaining widely-used mobile-money + banks so ads can
-- offer them. Enum labels added by ALTER TYPE ... ADD VALUE can't be USED in the
-- same transaction, but nothing here references them — they're consumed by the
-- app's PAYMENT_METHODS list — so this is safe.
alter type payment_method add value if not exists 'MPESA';       -- M-Pesa
alter type payment_method add value if not exists 'CBE_BIRR';    -- CBE Birr (wallet)
alter type payment_method add value if not exists 'WEGAGEN';     -- Wegagen Bank
alter type payment_method add value if not exists 'HIBRET';      -- Hibret Bank (United)
alter type payment_method add value if not exists 'NIB';         -- Nib International Bank
alter type payment_method add value if not exists 'ZEMEN';       -- Zemen Bank
alter type payment_method add value if not exists 'BUNNA';       -- Bunna Bank
alter type payment_method add value if not exists 'OROMIA';      -- Oromia Bank
alter type payment_method add value if not exists 'COOP_OROMIA'; -- Cooperative Bank of Oromia
