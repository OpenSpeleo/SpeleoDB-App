# UI completion follows the authoritative commit

An operation may publish its committed result before completing background
housekeeping. Do not keep the whole UI busy while awaiting that housekeeping.
Derive blocking from pending entity IDs that still exist in authoritative state;
do not use a timer or optimistically pretend persistence succeeded.

When successive operations can overlap, an old completion must clear only its
own pending state or confirmation. Test with manually held promises: publish the
first commit, start the next action, and finish the old operation while the next
is confirming or saving. Also verify shared-storage cleanup at its real seam.
