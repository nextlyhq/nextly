# The round marker the review protocol has the agent write under a review's
# heading, naming the head it reviewed. One definition, which the review
# workflow's gate (was a request already answered?) and its post job (is a
# payload a finished round?) both include, so the two cannot disagree about
# what a finished round looks like.
def round_marker($sha): "<!-- pr-review-agent round:[1-9][0-9]* head:" + $sha + " -->";

# Whether a review body carries the round marker for the head `$sha`.
def carries_round_marker($sha): (. // "") | test(round_marker($sha));
