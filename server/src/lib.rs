// Library entry point — exposes modules for integration tests.
//
// Allow pre-existing clippy violations in modules that were written for
// binary-only use and are not part of this refactor.
#![allow(clippy::new_without_default)]
#![allow(clippy::too_many_arguments)]
#![allow(clippy::useless_format)]
#![allow(clippy::manual_map)]
#![allow(clippy::ptr_arg)]
#![allow(private_interfaces)]

pub mod db;
pub mod dolt;
pub mod routes;
