# widget-kit-fixture

A test fixture for the e2e suite: widgets drawn by their own components (one built only from the plugin widget kit, one that throws, and one drawing an unlabelled control for the widget accessibility check), and widgets drawn by core's displays, among them one whose answer is always empty and whose widget hides when empty. The kit card and the full-width card declare preview cases, which the widget check's page draws (`widget-check-fixture`, registered only on the e2e suite's own server).
