export { Container, container, type Factory } from "./container";
// What a caller needs to look services up. Registering them is a separate
// import, from `./register`: it loads every service registration, and a
// re-export here would make that the cost of asking for the container.
export { getService, isServicesRegistered } from "./service-access";
export type { NextlyServiceConfig, ServiceMap } from "./register";
