IF v_actor_id IS NULL
   AND current_user NOT IN ('postgres', 'service_role')
THEN
    RAISE EXCEPTION 'Authentication required';
END IF;