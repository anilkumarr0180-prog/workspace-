SELECT
    d.defaclrole::regrole AS grantor,
    COALESCE(n.nspname, '*') AS schema_name,
    d.defaclobjtype AS object_type,
    d.defaclacl AS default_acl
FROM pg_default_acl AS d
LEFT JOIN pg_namespace AS n
    ON n.oid = d.defaclnamespace
WHERE d.defaclrole = 'supabase_admin'::regrole
ORDER BY schema_name, object_type;